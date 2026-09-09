// Prisma 7 產生的模型型別名稱帶 Model 後綴。
import type { CoachModel, MemberModel } from "@/generated/prisma/models";
import { verifyIdToken, type VerifiedLineUser } from "./liff-auth";
import { prisma } from "./prisma";

/**
 * 從 Authorization: Bearer <LIFF ID token> 取出並驗證身分。
 * 所有需要身分的 API 一律走這裡，不接受前端自報 userId（SPEC.md §4 身分驗證規則）。
 */
export async function getVerifiedUser(req: Request): Promise<VerifiedLineUser | null> {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return verifyIdToken(header.slice(7));
}

export type AuthResult<T> = { ok: true; value: T } | { ok: false; response: Response };

/** 取出當前教練。未通過驗證或非教練時回傳可直接 return 的錯誤 Response。 */
export async function requireCoach(req: Request): Promise<AuthResult<CoachModel>> {
  const user = await getVerifiedUser(req);
  if (!user) {
    return { ok: false, response: Response.json({ error: "unauthorized" }, { status: 401 }) };
  }

  const coach = await prisma.coach.findUnique({ where: { lineUserId: user.userId } });
  if (!coach) {
    return { ok: false, response: Response.json({ error: "not_a_coach" }, { status: 403 }) };
  }

  return { ok: true, value: coach };
}

/** 取出當前學員。 */
export async function requireMember(req: Request): Promise<AuthResult<MemberModel>> {
  const user = await getVerifiedUser(req);
  if (!user) {
    return { ok: false, response: Response.json({ error: "unauthorized" }, { status: 401 }) };
  }

  const member = await prisma.member.findUnique({ where: { lineUserId: user.userId } });
  if (!member) {
    return { ok: false, response: Response.json({ error: "not_a_member" }, { status: 403 }) };
  }

  return { ok: true, value: member };
}

/** 邀請連結。學員在 LINE 內點開即進入 LIFF，不需另外登入。 */
export function inviteUrl(token: string): string {
  return `https://liff.line.me/${process.env.NEXT_PUBLIC_LIFF_ID}?t=${token}`;
}

/** 邀請碼有效天數。過期後教練可重新產生。 */
export const INVITE_TTL_DAYS = 30;

export function inviteExpiry(): Date {
  return new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
}
