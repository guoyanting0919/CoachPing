import { z } from "zod";
import { requireCoach } from "@/lib/auth";
import { applyApprovedLeave } from "@/lib/leave";
import { enqueueMemberChange } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ decision: z.enum(["approve", "reject"]) });

/** 教練決定請假結果。無論同意與否都要通知學員——他在等答案。 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireCoach(req);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400 });

  const leave = await prisma.leaveRequest.findFirst({
    where: { id, status: "pending", session: { coachId: auth.value.id } },
    select: {
      id: true,
      memberId: true,
      sessionId: true,
      member: { select: { lineUserId: true } },
    },
  });
  if (!leave) return Response.json({ error: "not_found" }, { status: 404 });

  const approve = parsed.data.decision === "approve";

  const result = await prisma.$transaction(async (tx) => {
    await tx.leaveRequest.update({
      where: { id: leave.id },
      data: { status: approve ? "approved" : "rejected", resolvedAt: new Date() },
    });

    const applied = approve
      ? await applyApprovedLeave(tx, leave.sessionId, leave.memberId)
      : { sessionCancelled: false };

    // 學員在等結果，通知與決定必須同時成立。
    if (leave.member.lineUserId) {
      await enqueueMemberChange(
        tx,
        leave.member.lineUserId,
        leave.sessionId,
        auth.value.id,
        {
          kind: approve ? "leave_approved" : "leave_rejected",
          leaveRequestId: leave.id,
        },
      );
    }

    return applied;
  });

  return Response.json({
    ok: true,
    decision: parsed.data.decision,
    sessionCancelled: result.sessionCancelled,
  });
}
