import { z } from "zod";
import { requireCoach } from "@/lib/auth";
import {
  cancelPendingNotifications,
  enqueueSessionChange,
  rescheduleReminders,
} from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { taipeiDateTime, ymd } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * single：只改這一堂（可換日期與時間）
 * future：這堂及同系列之後的所有課。只改「每天幾點上」與時長／地點，
 *         各堂的日期維持不變——教練說「以後都改成 20:00」是這個意思，
 *         而不是把整串課往後推。
 */
const patchSchema = z.object({
  scope: z.enum(["single", "future"]).default("single"),
  date: z.string().regex(YMD).optional(),
  time: z.string().regex(HHMM).optional(),
  durationMin: z.number().int().min(15).max(240).optional(),
  location: z.string().trim().max(100).nullable().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireCoach(req);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400 });
  const body = parsed.data;

  const session = await prisma.session.findFirst({
    where: { id, coachId: auth.value.id },
  });
  if (!session) return Response.json({ error: "not_found" }, { status: 404 });

  const common = {
    ...(body.durationMin !== undefined ? { durationMin: body.durationMin } : {}),
    ...(body.location !== undefined ? { location: body.location || null } : {}),
  };

  if (body.scope === "single") {
    const date = body.date ?? ymdInTaipei(session.startAt);

    if (date < ymd(new Date())) {
      return Response.json({ error: "past_date" }, { status: 400 });
    }

    const time = body.time ?? hhmmInTaipei(session.startAt);

    const newStartAt = taipeiDateTime(date, time);
    const moved = newStartAt.getTime() !== session.startAt.getTime();

    await prisma.$transaction(async (tx) => {
      await tx.session.update({
        where: { id },
        data: { ...common, startAt: newStartAt },
      });
      // 課移動了，尚未送出的提醒也要跟著移動。
      await rescheduleReminders(tx, id);

      // 只有時間真的變了才通知。改地點或時長不值得吵學員。
      if (moved) {
        await enqueueSessionChange(
          tx,
          [{ id, oldStartAt: session.startAt }],
          "rescheduled",
        );
      }
    });

    return Response.json({ ok: true, updated: 1 });
  }

  if (!session.seriesId) {
    return Response.json({ error: "not_a_series" }, { status: 400 });
  }

  const future = await prisma.session.findMany({
    where: {
      coachId: auth.value.id,
      seriesId: session.seriesId,
      startAt: { gte: session.startAt },
      status: "scheduled",
    },
    select: { id: true, startAt: true },
  });

  // 每堂各自保留原本的日期，只換時間，所以逐筆更新而非一次 updateMany。
  await prisma.$transaction(async (tx) => {
    const moved: { id: string; oldStartAt: Date }[] = [];

    for (const s of future) {
      const newStartAt = body.time
        ? taipeiDateTime(ymdInTaipei(s.startAt), body.time)
        : s.startAt;

      await tx.session.update({
        where: { id: s.id },
        data: { ...common, startAt: newStartAt },
      });
      await rescheduleReminders(tx, s.id);

      if (newStartAt.getTime() !== s.startAt.getTime()) {
        moved.push({ id: s.id, oldStartAt: s.startAt });
      }
    }

    await enqueueSessionChange(tx, moved, "rescheduled");
  });

  return Response.json({ ok: true, updated: future.length });
}

/** 取消。不刪除記錄，只改狀態（SPEC.md §4 只停用不刪除）。 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireCoach(req);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const scope = new URL(req.url).searchParams.get("scope") === "future" ? "future" : "single";

  const session = await prisma.session.findFirst({
    where: { id, coachId: auth.value.id },
  });
  if (!session) return Response.json({ error: "not_found" }, { status: 404 });

  if (scope === "single" || !session.seriesId) {
    await prisma.$transaction(async (tx) => {
      // 必須在標記取消前排入：enqueueSessionChange 要讀 session_participants，
      // 而通知內容渲染時會查課程資料，取消狀態不影響參與者，順序上安全。
      await enqueueSessionChange(tx, [{ id }], "cancelled");
      await tx.session.update({ where: { id }, data: { status: "cancelled" } });
      await cancelPendingNotifications(tx, [id]);
    });
    return Response.json({ ok: true, cancelled: 1 });
  }

  const cancelled = await prisma.$transaction(async (tx) => {
    const targets = await tx.session.findMany({
      where: {
        coachId: auth.value.id,
        seriesId: session.seriesId,
        startAt: { gte: session.startAt },
        status: "scheduled",
      },
      select: { id: true },
    });
    const ids = targets.map((t) => t.id);

    await enqueueSessionChange(
      tx,
      ids.map((id) => ({ id })),
      "cancelled",
    );
    await tx.session.updateMany({
      where: { id: { in: ids } },
      data: { status: "cancelled" },
    });
    await cancelPendingNotifications(tx, ids);

    return ids.length;
  });

  return Response.json({ ok: true, cancelled });
}

function ymdInTaipei(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function hhmmInTaipei(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}
