import { z } from "zod";
import { verifyIdToken } from "@/lib/liff-auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  idToken: z.string().min(1),
  /** 邀請碼，可能是教練碼或學員碼。用來決定未註冊者要看哪張表單。 */
  inviteToken: z.string().optional(),
});

/**
 * LIFF 開啟時的第一支 API：告訴前端「你是誰、該看什麼畫面」。
 * 身分一律由 ID token 決定，不接受前端自報 userId。
 */
export async function POST(req: Request): Promise<Response> {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const verified = await verifyIdToken(parsed.data.idToken);
  if (!verified) {
    return Response.json({ error: "invalid_id_token" }, { status: 401 });
  }

  const [coach, member] = await Promise.all([
    prisma.coach.findUnique({
      where: { lineUserId: verified.userId },
      select: { id: true, name: true },
    }),
    prisma.member.findUnique({
      where: { lineUserId: verified.userId },
      select: { id: true, displayName: true },
    }),
  ]);

  if (coach) {
    return Response.json({ role: "coach", coach, lineName: verified.displayName });
  }
  if (member) {
    return Response.json({ role: "member", member, lineName: verified.displayName });
  }

  // 尚未註冊：依邀請碼判斷要引導到哪張表單。
  const token = parsed.data.inviteToken;
  if (token) {
    const coachInvite = await prisma.coachInvite.findUnique({
      where: { token },
      select: { label: true, usedAt: true, expiresAt: true },
    });
    if (coachInvite) {
      return Response.json({
        role: "none",
        invite: {
          kind: "coach",
          valid: !coachInvite.usedAt && coachInvite.expiresAt > new Date(),
          label: coachInvite.label,
        },
        lineName: verified.displayName,
      });
    }

    const memberInvite = await prisma.invite.findUnique({
      where: { token },
      select: {
        usedAt: true,
        expiresAt: true,
        coach: { select: { name: true } },
        member: { select: { displayName: true } },
      },
    });
    if (memberInvite) {
      return Response.json({
        role: "none",
        invite: {
          kind: "member",
          valid: !memberInvite.usedAt && memberInvite.expiresAt > new Date(),
          coachName: memberInvite.coach.name,
          suggestedName: memberInvite.member.displayName,
        },
        lineName: verified.displayName,
      });
    }
  }

  return Response.json({ role: "none", invite: null, lineName: verified.displayName });
}
