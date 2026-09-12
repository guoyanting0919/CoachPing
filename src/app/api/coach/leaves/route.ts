import { requireCoach } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 待教練決定的請假申請。自動核准的不會出現在這裡——那些不需要處理。
 * 已取消的課也不會：課取消後那筆申請再也沒有東西可決定，留在待辦裡只會讓
 * 教練點進一堂不存在的課（結束合作一次取消多堂課時尤其明顯）。
 * 請假記錄本身不動——他當時確實申請了、確實沒人決定，那是歷史。
 */
export async function GET(req: Request): Promise<Response> {
  const auth = await requireCoach(req);
  if (!auth.ok) return auth.response;

  const leaves = await prisma.leaveRequest.findMany({
    where: {
      status: "pending",
      session: { coachId: auth.value.id, status: "scheduled" },
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      reason: true,
      createdAt: true,
      memberId: true,
      session: {
        select: {
          id: true,
          startAt: true,
          durationMin: true,
          participants: { select: { memberId: true } },
        },
      },
    },
  });

  // 教練端顯示的名字一律取自關係（SPEC.md §4）。
  const links = await prisma.coachMember.findMany({
    where: { coachId: auth.value.id },
    select: { memberId: true, displayName: true },
  });
  const nameOf = new Map(links.map((l) => [l.memberId, l.displayName]));

  return Response.json({
    leaves: leaves.map((l) => ({
      id: l.id,
      memberName: nameOf.get(l.memberId) ?? "（已移除）",
      reason: l.reason,
      startAt: l.session.startAt.toISOString(),
      durationMin: l.session.durationMin,
      /** 同堂其他學員人數。教練據此判斷同意後這堂課還上不上得成。 */
      otherParticipants: l.session.participants.length - 1,
      /** 已經過了上課時間的申請，教練通常只是補登。 */
      started: l.session.startAt <= new Date(),
    })),
  });
}
