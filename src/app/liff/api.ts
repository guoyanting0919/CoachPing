"use client";

/**
 * LIFF 前端呼叫需要身分的 API。身分一律以 Authorization header 帶 ID token，
 * 伺服器端會向 LINE 驗證後才採信（SPEC.md §4 身分驗證規則）。
 */
export async function api<T>(
  path: string,
  idToken: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${idToken}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }

  return (await res.json()) as T;
}
