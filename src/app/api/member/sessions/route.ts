import { requireMember } from "@/lib/auth";
import { hoursUntil } from "@/lib/leave";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 學員自己的課表。跨教練合併顯示——學員可能同時上多位教練的課。 */
export async function GET(req: Request): Promise<Response> {
  const auth = await requireMember(req);
  if (!auth.ok) return auth.response;

  const now = new Date();

  const sessions = await prisma.session.findMany({
    where: {
      status: "scheduled",
      startAt: { gte: now },
      participants: { some: { memberId: auth.value.id } },
    },
    orderBy: { startAt: "asc" },
    take: 50,
    select: {
      id: true,
      startAt: true,
      durationMin: true,
      location: true,
      coachId: true,
      coach: { select: { name: true, leaveDeadlineHours: true } },
      leaveRequests: {
        where: { memberId: auth.value.id, status: "pending" },
        select: { id: true },
      },
    },
  });

  return Response.json({
    sessions: sessions.map((s) => ({
      id: s.id,
      startAt: s.startAt.toISOString(),
      durationMin: s.durationMin,
      location: s.location,
      coachName: s.coach.name,
      /** 已送出但教練尚未決定的請假。 */
      leavePending: s.leaveRequests.length > 0,
      /** 現在請假是否會自動核准。UI 據此說明後果。 */
      leaveAutoApproves: hoursUntil(s.startAt, now) >= s.coach.leaveDeadlineHours,
      leaveDeadlineHours: s.coach.leaveDeadlineHours,
    })),
  });
}
