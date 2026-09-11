import { z } from "zod";
import { resolveIdentities, type Identities } from "@/lib/identity";
import { verifyIdToken } from "@/lib/liff-auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  idToken: z.string().min(1),
  /** 邀請碼，可能是教練碼或學員碼。決定要看哪張註冊表單。 */
  inviteToken: z.string().optional(),
});

type InviteView =
  | { kind: "coach"; valid: boolean; label: string }
  | { kind: "member"; valid: boolean; coachName: string; suggestedName: string };

/**
 * LIFF 開啟時的第一支 API：告訴前端「你是誰、該看什麼畫面」。
 * 身分一律由 ID token 決定，不接受前端自報 userId。
 *
 * 回傳 coach 與 member 兩個欄位而非單一角色：同一人可能兩者皆是（雙重身分），
 * 由前端依 `?p=` 決定渲染哪一套介面。
 *
 * 邀請碼**不論有沒有身分都要查**。曾經只在「兩個身分都沒有」時才查，導致已註冊的人
 * 永遠走不到註冊表單——而註冊表單只有這一個入口，於是「學員要成為教練」「教練要成為
 * 別人的學員」「學員被第二位教練邀請」三條路全被擋死。
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

  const identities = await resolveIdentities(verified.userId);
  const invite = await describeInvite(parsed.data.inviteToken, identities);

  return Response.json({
    coach: identities.coach,
    member: identities.member,
    invite,
    lineName: verified.displayName,
  });
}

/**
 * 這張邀請碼值不值得拿出來打斷這個人。
 *
 * 回傳 null 代表「不用理它，照常顯示他的 App」。兩種情況會這樣：
 *
 * - 這張碼給不了他任何新東西（已經是教練了還拿教練碼）
 * - 碼失效了，而他已經註冊過——失效的碼不該打擾一個本來就有地方可去的人。
 *   完全沒註冊過的人則相反，必須看到「已失效」，否則他會不知道發生什麼事。
 */
async function describeInvite(
  token: string | undefined,
  identities: Identities,
): Promise<InviteView | null> {
  if (!token) return null;

  const registered = identities.coach !== null || identities.member !== null;
  /** 失效的碼只對「還沒有地方可去」的人有說明價值。 */
  const keepIfInvalid = !registered;

  const coachInvite = await prisma.coachInvite.findUnique({
    where: { token },
    select: { label: true, usedAt: true, expiresAt: true },
  });
  if (coachInvite) {
    // 已經是教練，這張碼給不了他新身分。直接讓他看教練 App。
    if (identities.coach) return null;

    const valid = !coachInvite.usedAt && coachInvite.expiresAt > new Date();
    if (!valid && !keepIfInvalid) return null;

    return { kind: "coach", valid, label: coachInvite.label };
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
    // 學員碼綁定的是「這位教練要加你」這段關係，不是「你成為學員」這件事。
    // 已經是別人的學員仍然值得走一次——那是連鎖健身房的常態，註冊時會合併記錄。
    const valid = !memberInvite.usedAt && memberInvite.expiresAt > new Date();
    if (!valid && !keepIfInvalid) return null;

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

    return {
      kind: "member",
      valid,
      coachName: memberInvite.coach.name,
      suggestedName: link?.displayName ?? "",
    };
  }

  return null;
}
