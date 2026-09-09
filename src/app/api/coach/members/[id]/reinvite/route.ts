import { inviteExpiry, inviteUrl, requireCoach } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 重新產生某位未連結學員的邀請連結（舊連結過期或教練弄丟了）。 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireCoach(req);
  if (!auth.ok) return auth.response;

  const { id: memberId } = await params;

  // 一律驗證這位學員確實屬於當前教練，否則等於讓任何教練替他人發邀請。
  const link = await prisma.coachMember.findUnique({
    where: { coachId_memberId: { coachId: auth.value.id, memberId } },
    select: { member: { select: { lineUserId: true } } },
  });
  if (!link) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  if (link.member.lineUserId) {
    return Response.json({ error: "already_linked" }, { status: 409 });
  }

  const invite = await prisma.$transaction(async (tx) => {
    // 作廢舊的未使用邀請，避免同一位學員有多條有效連結。
    await tx.invite.deleteMany({
      where: { coachId: auth.value.id, memberId, usedAt: null },
    });
    return tx.invite.create({
      data: { coachId: auth.value.id, memberId, expiresAt: inviteExpiry() },
    });
  });

  return Response.json({ inviteUrl: inviteUrl(invite.token) });
}
