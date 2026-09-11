import type { Role } from "./line";
import { prisma } from "./prisma";

/**
 * 一個 LINE 使用者擁有的所有身分。
 *
 * 同一個 LINE 帳號可以同時是教練與學員（雙重身分）——`coaches` 與 `members` 的
 * `line_user_id` 唯一性各自獨立，兩張表本來就互不干涉。這裡刻意回傳「集合」而非
 * 單一角色，由呼叫端自己決定要用哪一個；系統中不該再有第二處做這個判斷。
 *
 * 決策脈絡見 docs/adr/0001-dual-role-via-rich-menu-mode.md。
 */
export type Identities = {
  coach: { id: string; name: string } | null;
  member: { id: string; displayName: string } | null;
};

export async function resolveIdentities(lineUserId: string): Promise<Identities> {
  const [coach, member] = await Promise.all([
    prisma.coach.findUnique({
      where: { lineUserId },
      select: { id: true, name: true },
    }),
    prisma.member.findUnique({
      where: { lineUserId },
      select: { id: true, displayName: true },
    }),
  ]);

  return { coach, member };
}

/** 這個人是否同時具備兩種身分。 */
export function isDualRole(identities: Identities): boolean {
  return identities.coach !== null && identities.member !== null;
}

/**
 * 在只能挑一個身分的場合（綁 Rich Menu、決定預設畫面）挑出哪一個。
 *
 * 雙重身分者一律以教練為準：教練是主身分，畫面最多、最常需要開網頁，
 * 而學員模式最高頻的兩個動作（查課表、請假）都從 Rich Menu 一鍵直達。
 *
 * 系統中所有「二選一」的決定都必須經過這裡，不要在別處重寫這個順序。
 *
 * 雙重身分者回 `coach_dual`：教練是主身分，而 dual 版選單上有切換鍵，
 * 他自己按一下就能換到學員模式。`member_dual` 不會從這裡產生——那是
 * 「剛完成學員註冊」與「主動切換過去」兩個情境才會綁的，由呼叫端明確指定。
 */
export function primaryRole(identities: Identities): Role {
  if (identities.coach) return identities.member ? "coach_dual" : "coach";
  if (identities.member) return "member";
  return "none";
}
