/**
 * Rich Menu 各按鈕帶的 `?p=` 值屬於哪一邊。
 *
 * 只有雙重身分者需要這個判斷：他兩邊的畫面都進得去，得靠參數決定要渲染哪一套。
 * 單一身分者的參數若對不上自己那套，各自的 App 會落到 default 分支，行為與過去相同。
 */
const MEMBER_PAGES = new Set(["leave", "contact", "profile", "book"]);

export function isMemberPage(page: string | null): boolean {
  return page !== null && MEMBER_PAGES.has(page);
}
