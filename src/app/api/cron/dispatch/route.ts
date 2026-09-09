import { lineClient } from "@/lib/line";
import { renderCoachLeave, renderMemberReminder } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 單次執行的處理上限。cron 每分鐘一次，這個量遠超過實際需求。 */
const BATCH_SIZE = 25;
/** 同時送出的數量。LINE 沒有嚴格的並行限制，壓低只是為了不觸發限流。 */
const CONCURRENCY = 5;
/** 卡在 sending 超過這個時間就視為程序中斷，回收重送。 */
const STALE_CLAIM_MINUTES = 5;
/** 連續失敗這麼多次就放棄，避免無效項目每分鐘重試到天荒地老。 */
const MAX_ATTEMPTS = 3;

/**
 * 推播派送。由外部 cron 每分鐘呼叫一次（SPEC.md §5）。
 *
 *   curl -X POST https://<host>/api/cron/dispatch \
 *        -H "Authorization: Bearer $CRON_SECRET"
 */
type Claimed = {
  id: string;
  type: string;
  targetLineUserId: string;
  sessionId: string | null;
  payload: unknown;
  attempts: number;
};

export async function POST(req: Request): Promise<Response> {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();

  // 回收上一輪中斷留下的項目。沒有這步，程序被中斷的推播會永遠卡住。
  const reclaimed = await prisma.notification.updateMany({
    where: {
      status: "sending",
      claimedAt: { lt: new Date(now.getTime() - STALE_CLAIM_MINUTES * 60_000) },
    },
    data: { status: "pending" },
  });

  // 選取、取走、回傳合併成一次查詢。資料庫與函式可能位於不同區域，
  // 每省一次往返就省一次跨區延遲。
  //
  // FOR UPDATE SKIP LOCKED 讓兩次 cron 重疊時，後者直接跳過已被鎖住的列，
  // 而不是等待或重複取走——這是佇列取件的標準做法。
  const claimed = await prisma.$queryRaw<Claimed[]>`
    UPDATE notifications
    SET status = 'sending'::"NotificationStatus", claimed_at = ${now}
    WHERE id IN (
      SELECT id FROM notifications
      WHERE status = 'pending'::"NotificationStatus" AND send_at <= ${now}
      ORDER BY send_at ASC
      LIMIT ${BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING
      id,
      type::text AS type,
      target_line_user_id AS "targetLineUserId",
      session_id AS "sessionId",
      payload,
      attempts
  `;

  if (claimed.length === 0) {
    return Response.json({ reclaimed: reclaimed.count, claimed: 0, sent: 0, failed: 0 });
  }

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < claimed.length; i += CONCURRENCY) {
    const batch = claimed.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(deliver));
    for (const ok of results) {
      if (ok) sent++;
      else failed++;
    }
  }

  return Response.json({
    reclaimed: reclaimed.count,
    claimed: claimed.length,
    sent,
    failed,
  });
}

async function deliver(n: Claimed): Promise<boolean> {
  try {
    const text = await renderText(n);

    // 內容已無意義（例如課程在排入佇列後被取消）就標記完成，不送出。
    if (text === null) {
      await prisma.notification.update({
        where: { id: n.id },
        data: { status: "sent", sentAt: new Date(), error: "skipped: 內容已失效" },
      });
      return true;
    }

    await lineClient().pushMessage({
      to: n.targetLineUserId,
      messages: [{ type: "text", text }],
    });

    await prisma.notification.update({
      where: { id: n.id },
      data: { status: "sent", sentAt: new Date(), error: null },
    });
    return true;
  } catch (err) {
    await handleFailure(n, err);
    return false;
  }
}

async function renderText(n: Claimed): Promise<string | null> {
  switch (n.type) {
    case "member_reminder":
      return n.sessionId ? renderMemberReminder(n.sessionId) : null;

    case "coach_leave": {
      const id = (n.payload as { leaveRequestId?: string } | null)?.leaveRequestId;
      return id ? renderCoachLeave(id) : null;
    }
    default:
      console.warn("[cron] 未知的通知類型:", n.type);
      return null;
  }
}

async function handleFailure(n: Claimed, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  const attempts = n.attempts + 1;

  // 學員封鎖官方帳號時 LINE 回 403。標記起來讓教練端顯示警示——
  // 教練會誤以為學員收到了通知，那比從未連結更危險（SPEC.md §5）。
  if (/\b403\b/.test(message)) {
    await prisma.member.updateMany({
      where: { lineUserId: n.targetLineUserId },
      data: { lineBlocked: true },
    });
  }

  await prisma.notification.update({
    where: { id: n.id },
    data: {
      // 尚有重試機會就放回佇列，下一輪再送。
      status: attempts >= MAX_ATTEMPTS ? "failed" : "pending",
      attempts,
      claimedAt: null,
      error: message.slice(0, 500),
    },
  });

  console.error("[cron] 推播失敗", n.id, n.type, message);
}
