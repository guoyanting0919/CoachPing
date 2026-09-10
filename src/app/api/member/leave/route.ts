import { z } from "zod";
import { requireMember } from "@/lib/auth";
import { applyApprovedLeave, hoursUntil } from "@/lib/leave";
import { flushNotifications } from "@/lib/dispatch";
import { enqueueCoachLeave } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  sessionId: z.string().min(1),
  reason: z.string().trim().max(200).optional(),
});

/**
 * 學員請假（SPEC.md §6）。
 *
 * 距上課達門檻（教練可設，預設 24 小時）即自動核准，只通知教練；
 * 未達門檻則轉為待確認，由教練決定。90% 的請假是提前的，
 * 那些不該打擾教練。
 */
export async function POST(req: Request): Promise<Response> {
  const auth = await requireMember(req);
  if (!auth.ok) return auth.response;
  const member = auth.value;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400 });

  const session = await prisma.session.findFirst({
    where: {
      id: parsed.data.sessionId,
      status: "scheduled",
      participants: { some: { memberId: member.id } },
    },
    select: {
      id: true,
      startAt: true,
      coach: { select: { id: true, lineUserId: true, leaveDeadlineHours: true } },
    },
  });
  if (!session) return Response.json({ error: "session_not_found" }, { status: 404 });

  const now = new Date();
  if (session.startAt <= now) {
    return Response.json({ error: "already_started" }, { status: 400 });
  }

  const existing = await prisma.leaveRequest.findFirst({
    where: { sessionId: session.id, memberId: member.id, status: "pending" },
    select: { id: true },
  });
  if (existing) return Response.json({ error: "already_requested" }, { status: 409 });

  const autoApprove =
    hoursUntil(session.startAt, now) >= session.coach.leaveDeadlineHours;

  const result = await prisma.$transaction(async (tx) => {
    const leave = await tx.leaveRequest.create({
      data: {
        sessionId: session.id,
        memberId: member.id,
        reason: parsed.data.reason || null,
        status: autoApprove ? "auto_approved" : "pending",
        resolvedAt: autoApprove ? now : null,
      },
      select: { id: true },
    });

    const applied = autoApprove
      ? await applyApprovedLeave(tx, session.id, member.id)
      : { sessionCancelled: false };

    // 通知教練與請假本身必須同時成立，否則會出現「學員請了假但教練不知道」。
    await enqueueCoachLeave(
      tx,
      leave.id,
      session.id,
      session.coach.lineUserId,
      session.coach.id,
    );

    return applied;
  });

  // 臨時請假時教練需要立刻知道，這是整個系統裡最不能延遲的一則。
  flushNotifications();

  return Response.json({
    ok: true,
    status: autoApprove ? "auto_approved" : "pending",
    sessionCancelled: result.sessionCancelled,
  });
}
