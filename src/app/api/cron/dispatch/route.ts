import { dispatchDue } from "@/lib/dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 推播派送端點。由外部 cron 每 30 分鐘呼叫一次（SPEC.md §5）。
 *
 * 派送邏輯本身在 src/lib/dispatch.ts——取消／改期／請假那幾支 API 也會
 * 在回應後直接呼叫它，不必等下一次 cron。
 *
 *   curl -X POST https://<host>/api/cron/dispatch \
 *        -H "Authorization: Bearer $CRON_SECRET"
 */
export async function POST(req: Request): Promise<Response> {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  return Response.json(await dispatchDue());
}
