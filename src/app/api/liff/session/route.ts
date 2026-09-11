import { z } from "zod";
import { resolveIdentities } from "@/lib/identity";
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
 *
 * 回傳 coach 與 member 兩個欄位而非單一角色：同一人可能兩者皆是（雙重身分），
 * 由前端依 `?p=` 決定渲染哪一套介面。邀請碼只在兩個身分都沒有時才需要查。
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

  const { coach, member } = await resolveIdentities(verified.userId);

  if (coach || member) {
    return Response.json({ coach, member, invite: null, lineName: verified.displayName });
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
        coach: null,
        member: null,
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
        coachId: true,
        memberId: true,
        coach: { select: { name: true } },
      },
    });
    if (memberInvite) {
      // 建議名字取自教練在關係上填的稱呼，不是 members.display_name——
      // 後者是學員自報的，可能是別的教練認得的名字。
      const link = await prisma.coachMember.findUnique({
        where: {
          coachId_memberId: {
            coachId: memberInvite.coachId,
            memberId: memberInvite.memberId,
          },
        },
        select: { displayName: true },
      });

      return Response.json({
        coach: null,
        member: null,
        invite: {
          kind: "member",
          valid: !memberInvite.usedAt && memberInvite.expiresAt > new Date(),
          coachName: memberInvite.coach.name,
          suggestedName: link?.displayName ?? "",
        },
        lineName: verified.displayName,
      });
    }
  }

  return Response.json({ coach: null, member: null, invite: null, lineName: verified.displayName });
}
