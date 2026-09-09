import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireCoach } from "@/lib/auth";
import { enqueueSessionReminders } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_WEEKS,
  MAX_PARTICIPANTS,
  MAX_WEEKS,
  generateStartTimes,
  overlaps,
} from "@/lib/schedule";
import { taipeiDateTime, ymd } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 取得區間內的課程。from／to 為台北時間的 YYYY-MM-DD，含頭含尾。 */
export async function GET(req: Request): Promise<Response> {
  const auth = await requireCoach(req);
  if (!auth.ok) return auth.response;

  const params = new URL(req.url).searchParams;
  const from = params.get("from");
  const to = params.get("to");
  if (!from || !to || !YMD.test(from) || !YMD.test(to)) {
    return Response.json({ error: "invalid_range" }, { status: 400 });
  }

  const sessions = await prisma.session.findMany({
    where: {
      coachId: auth.value.id,
      startAt: {
        gte: taipeiDateTime(from, "00:00"),
        // to 當天整天都要涵蓋，所以取隔天 00:00 之前。
        lt: new Date(taipeiDateTime(to, "00:00").getTime() + 24 * 60 * 60 * 1000),
      },
    },
    orderBy: { startAt: "asc" },
    select: {
      id: true,
      seriesId: true,
      startAt: true,
      durationMin: true,
      location: true,
      status: true,
      participants: { select: { memberId: true } },
    },
  });

  // 教練端顯示的名字一律取自關係，不讀 members.display_name（SPEC.md §4）。
  const links = await prisma.coachMember.findMany({
    where: { coachId: auth.value.id },
    select: { memberId: true, displayName: true, member: { select: { lineUserId: true } } },
  });
  const nameOf = new Map(links.map((l) => [l.memberId, l.displayName]));
  const linkedOf = new Map(links.map((l) => [l.memberId, l.member.lineUserId !== null]));

  return Response.json({
    sessions: sessions.map((s) => ({
      id: s.id,
      seriesId: s.seriesId,
      startAt: s.startAt.toISOString(),
      durationMin: s.durationMin,
      location: s.location,
      status: s.status,
      participants: s.participants.map((p) => ({
        id: p.memberId,
        name: nameOf.get(p.memberId) ?? "（已移除）",
        linked: linkedOf.get(p.memberId) ?? false,
      })),
    })),
  });
}

const createSchema = z.object({
  memberIds: z.array(z.string()).min(1).max(MAX_PARTICIPANTS),
  startDate: z.string().regex(YMD),
  time: z.string().regex(HHMM),
  /** 1 = 單堂課程。星期幾由 startDate 決定，不另外指定。 */
  weeks: z.number().int().min(1).max(MAX_WEEKS).default(DEFAULT_WEEKS),
  durationMin: z.number().int().min(15).max(240).optional(),
  location: z.string().trim().max(100).optional(),
  /** 明知撞課仍要建立。 */
  force: z.boolean().default(false),
});

export async function POST(req: Request): Promise<Response> {
  const auth = await requireCoach(req);
  if (!auth.ok) return auth.response;
  const coach = auth.value;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  const body = parsed.data;

  // 課程不能排到過去。前端月曆已擋，但停留很久的分頁仍可能送出昨天的日期。
  if (body.startDate < ymd(new Date())) {
    return Response.json({ error: "past_date" }, { status: 400 });
  }

  // 只能為自己的學員排課。少了這道，任何教練都能替別人的學員排課。
  const links = await prisma.coachMember.findMany({
    where: { coachId: coach.id, memberId: { in: body.memberIds }, status: "active" },
    select: { memberId: true },
  });
  if (links.length !== body.memberIds.length) {
    return Response.json({ error: "member_not_found" }, { status: 400 });
  }

  const durationMin = body.durationMin ?? coach.defaultDuration;
  const startTimes = generateStartTimes({
    startDate: body.startDate,
    time: body.time,
    weeks: body.weeks,
  });

  if (!body.force) {
    const conflicts = await findConflicts(coach.id, startTimes, durationMin);
    if (conflicts.length) {
      return Response.json(
        { error: "conflicts", conflicts: conflicts.map((d) => d.toISOString()) },
        { status: 409 },
      );
    }
  }

  // 同一次排課視為一個系列，之後可依 seriesId 批次改期或取消。
  // 單堂課程沒有系列可言，維持 null。
  const seriesId = startTimes.length > 1 ? randomUUID() : null;

  // 建立課程與排入提醒必須同時成立，否則會出現「課排好了但沒人會被通知」。
  const reminders = await prisma.$transaction(async (tx) => {
    const ids: string[] = [];

    for (const startAt of startTimes) {
      const created = await tx.session.create({
        data: {
          coachId: coach.id,
          seriesId,
          startAt,
          durationMin,
          location: body.location || null,
          participants: {
            create: body.memberIds.map((memberId) => ({ memberId })),
          },
        },
        select: { id: true },
      });
      ids.push(created.id);
    }

    return enqueueSessionReminders(tx, ids);
  });

  return Response.json({ created: startTimes.length, seriesId, reminders });
}

/** 回傳與既有課程撞期的開始時刻。已取消的課不算衝突。 */
async function findConflicts(
  coachId: string,
  startTimes: Date[],
  durationMin: number,
): Promise<Date[]> {
  if (!startTimes.length) return [];

  const first = startTimes[0];
  const last = startTimes[startTimes.length - 1];

  const existing = await prisma.session.findMany({
    where: {
      coachId,
      status: "scheduled",
      startAt: {
        // 前後各放寬一天，涵蓋跨日的邊界情況。
        gte: new Date(first.getTime() - 24 * 60 * 60 * 1000),
        lte: new Date(last.getTime() + 24 * 60 * 60 * 1000),
      },
    },
    select: { startAt: true, durationMin: true },
  });

  return startTimes.filter((t) =>
    existing.some((e) => overlaps(t, durationMin, e.startAt, e.durationMin)),
  );
}
