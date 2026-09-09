import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 設定診斷端點。以 CRON_SECRET 保護，用來確認 LINE 後台設定與本服務是否一致。
 * 除錯用途，正式上線前可移除。
 *
 *   GET /api/diag?key=<CRON_SECRET>
 */
export async function GET(req: Request): Promise<Response> {
  const key = new URL(req.url).searchParams.get("key");
  if (!key || key !== process.env.CRON_SECRET) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const result: Record<string, unknown> = {
    env: {
      DATABASE_URL: describe(process.env.DATABASE_URL),
      LINE_CHANNEL_SECRET: describe(process.env.LINE_CHANNEL_SECRET),
      LINE_CHANNEL_ACCESS_TOKEN: describe(token),
      APP_BASE_URL: process.env.APP_BASE_URL ?? null,
      NEXT_PUBLIC_LIFF_ID: process.env.NEXT_PUBLIC_LIFF_ID || null,
    },
  };

  // 1) access token 是否有效 —— 無效的話 reply / push 全部會靜默失敗
  result.botInfo = await callLine("https://api.line.me/v2/bot/info", token);

  // 2) LINE 那端登記的 webhook 網址與啟用狀態 —— 最常見的失敗原因
  result.webhookEndpoint = await callLine(
    "https://api.line.me/v2/bot/channel/webhook/endpoint",
    token,
  );

  // 3) 資料庫是否連得上
  try {
    result.db = {
      ok: true,
      coaches: await prisma.coach.count(),
      members: await prisma.member.count(),
    };
  } catch (err) {
    result.db = { ok: false, error: (err as Error).message };
  }

  return Response.json(result, { status: 200 });
}

function describe(v: string | undefined): string {
  if (!v) return "MISSING";
  return `set (${v.length} chars, 開頭 ${v.slice(0, 8)}…)`;
}

async function callLine(url: string, token: string | undefined): Promise<unknown> {
  if (!token) return { error: "no access token" };
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return { status: res.status, body: await res.json() };
  } catch (err) {
    return { error: (err as Error).message };
  }
}
