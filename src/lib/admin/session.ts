import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { env } from "../env";

/**
 * 管理後台的身分驗證（SPEC.md §16）。
 *
 * 單一密碼、單一權限。分三層：
 *   1. proxy.ts —— 只看 cookie 在不在，沒有就導去登入頁。純 UX，不是安全邊界。
 *   2. requireAdmin() —— 驗簽章與到期。真正的門。
 *   3. 每個 query／每個 Server Action 的第一行都呼叫 requireAdmin()。
 *
 * 為什麼不能只在 layout.tsx 擋：layout 不會在每次導航都重跑，巢狀 segment 與
 * Server Action 都會繞過它（Next.js 文件 app/guides/authentication）。
 */

export const ADMIN_COOKIE = "admin_session";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** cookie 值為 `<到期毫秒>.<簽章>`。除了到期時間沒有別的內容——只有一個使用者，沒什麼好帶的。 */
function sign(expiresAt: number): string {
  const mac = createHmac("sha256", env().ADMIN_SESSION_SECRET)
    .update(String(expiresAt))
    .digest("hex");
  return `${expiresAt}.${mac}`;
}

function verify(value: string | undefined): boolean {
  if (!value) return false;

  const dot = value.lastIndexOf(".");
  if (dot < 1) return false;

  const expiresAt = Number(value.slice(0, dot));
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;

  return safeEqual(value, sign(expiresAt));
}

/** 長度不同時 timingSafeEqual 會丟例外，所以先擋掉。 */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** 密碼正確就發 cookie。回傳是否成功，錯誤訊息由呼叫端決定。 */
export async function login(password: string): Promise<boolean> {
  if (!safeEqual(password, env().ADMIN_PASSWORD)) return false;

  const expiresAt = Date.now() + SESSION_TTL_MS;
  const store = await cookies();
  store.set(ADMIN_COOKIE, sign(expiresAt), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(expiresAt),
  });

  return true;
}

export async function logout(): Promise<void> {
  (await cookies()).delete(ADMIN_COOKIE);
}

/**
 * 未通過即 redirect，所以呼叫端不必檢查回傳值。
 * cache() 讓同一次 render 內只真的驗一次簽章。
 */
export const requireAdmin = cache(async (): Promise<void> => {
  const value = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!verify(value)) redirect("/admin/login");
});
