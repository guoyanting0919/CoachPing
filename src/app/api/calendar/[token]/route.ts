import { buildCalendar } from "@/lib/ical";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 行事曆涵蓋範圍。往前留一點讓教練看得到剛上完的課。 */
const PAST_DAYS = 30;
const FUTURE_DAYS = 180;

/**
 * 教練課表的 iCal 訂閱（SPEC.md §9）。
 *
 * 唯讀。刻意不做 Google OAuth 寫入：Calendar 寫入權限屬敏感範圍，
 * 可能需要通過 Google 的應用程式驗證審核，那是數週的流程。
 * 即時性由 LINE 推播負責，這裡只是讓教練在原本的日曆看到課表。
 *
 *   https://<host>/api/calendar/<icalToken>.ics
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;
  const icalToken = token.replace(/\.ics$/i, "");

  const coach = await prisma.coach.findUnique({
    where: { icalToken },
    select: { id: true, name: true },
  });

  // 不區分「代號錯誤」與「無此教練」，避免代號被逐一試探。
  if (!coach) {
    return new Response("Not found", { status: 404 });
  }

  const now = Date.now();
  const sessions = await prisma.session.findMany({
    where: {
      coachId: coach.id,
      status: "scheduled",
      startAt: {
        gte: new Date(now - PAST_DAYS * 24 * 60 * 60 * 1000),
        lte: new Date(now + FUTURE_DAYS * 24 * 60 * 60 * 1000),
      },
    },
    orderBy: { startAt: "asc" },
    select: {
      id: true,
      startAt: true,
      durationMin: true,
      location: true,
      participants: { select: { memberId: true } },
    },
  });

  // 教練端顯示的名字一律取自關係（SPEC.md §4）。
  const links = await prisma.coachMember.findMany({
    where: { coachId: coach.id },
    select: { memberId: true, displayName: true },
  });
  const nameOf = new Map(links.map((l) => [l.memberId, l.displayName]));

  const ics = buildCalendar({
    name: `${coach.name} 的課表`,
    events: sessions.map((s) => {
      const names =
        s.participants.map((p) => nameOf.get(p.memberId) ?? "?").join("、") || "課程";

      return {
        uid: `${s.id}@coachping`,
        start: s.startAt,
        end: new Date(s.startAt.getTime() + s.durationMin * 60_000),
        summary: names,
        description: [
          s.location ? `地點：${s.location}` : null,
          "此課表由 CoachPing 自動同步，唯讀。",
          "新增或修改課程請回到 LINE 的排課功能操作。",
        ]
          .filter((l) => l !== null)
          .join("\n"),
      };
    }),
  });

  return new Response(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      // 訂閱端自己會排程更新，這裡只要確保拿到的不是快取的舊版。
      "Cache-Control": "no-cache, must-revalidate",
      "Content-Disposition": 'inline; filename="coachping.ics"',
    },
  });
}
