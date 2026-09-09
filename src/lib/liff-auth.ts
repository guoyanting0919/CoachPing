import { env } from "./env";

export type VerifiedLineUser = {
  userId: string;
  displayName?: string;
};

/**
 * 驗證 LIFF 前端傳來的 ID token，回傳經 LINE 確認過的 userId。
 *
 * 前端 `liff.getProfile()` 拿到的 userId 一律不可信任——那只是一段 JSON，
 * 任何人都能偽造後直接打我們的 API 冒充他人。必須用 ID token 向 LINE 換取
 * 可信身分，並確認 token 是簽發給本應用（client_id）的。
 *
 * 需要 LIFF 的 openid scope。
 */
export async function verifyIdToken(idToken: string): Promise<VerifiedLineUser | null> {
  const res = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      id_token: idToken,
      client_id: env().LINE_LOGIN_CHANNEL_ID,
    }),
  });

  if (!res.ok) {
    console.warn("[liff-auth] ID token 驗證失敗", res.status, await res.text());
    return null;
  }

  const data = (await res.json()) as { sub?: string; name?: string };
  if (!data.sub) return null;

  return { userId: data.sub, displayName: data.name };
}

/**
 * 把教練填的官方帳號輸入正規化成可點擊的網址。
 * 接受 `@abc1234` 這種 ID 或完整網址，前者較符合教練的直覺。
 */
export function normalizeOaUrl(input: string): string | null {
  const v = input.trim();

  if (/^@[A-Za-z0-9._-]+$/.test(v)) {
    return `https://line.me/R/ti/p/${v}`;
  }

  if (/^https:\/\/(line\.me|lin\.ee|page\.line\.me)\//.test(v)) {
    return v;
  }

  return null;
}
