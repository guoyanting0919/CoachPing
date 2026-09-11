import { after } from "next/server";
import { lineClient } from "./line";
import {
  renderCoachBooking,
  renderCoachLeave,
  renderMemberChange,
  renderMemberReminder,
  renderMemberSchedule,
} from "./notifications";
import { prisma } from "./prisma";

/** 單次執行的處理上限。 */
const BATCH_SIZE = 25;
/** 同時送出的數量。LINE 沒有嚴格的並行限制，壓低只是為了不觸發限流。 */
const CONCURRENCY = 5;
/** 卡在 sending 超過這個時間就視為程序中斷，回收重送。 */
const STALE_CLAIM_MINUTES = 5;
/** 連續失敗這麼多次就放棄，避免無效項目每輪都重試到天荒地老。 */
const MAX_ATTEMPTS = 3;

/**
 * 推播派送核心（SPEC.md §5）。
 *
 * 兩個驅動來源：
 *   1. 外部 cron（每 30 分鐘）—— 負責到點的課前提醒。
 *   2. flushNotifications() —— 取消／改期／請假這類「使用者剛剛觸發」的通知，
 *      在該請求回應送出後立刻派送，不必等下一次 cron。
 *
 * 佇列語義不變：一律先寫 notifications 表再由這裡取走送出，
 * 重試、稽核、防重複都還在。這裡只是多了一個觸發時機。
 */
type Claimed = {
  id: string;
  type: string;
  targetLineUserId: string;
  sessionId: string | null;
  coachId: string | null;
  payload: unknown;
  attempts: number;
};


export type DispatchResult = {
  reclaimed: number;
  claimed: number;
  /** 真的送到 LINE、也就是真的會計費的則數（SPEC.md §16）。 */
  sent: number;
  /** 取走後才發現內容失效，沒有送出、不計費。 */
  skipped: number;
  failed: number;
};

export async function dispatchDue(): Promise<DispatchResult> {
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
  // FOR UPDATE SKIP LOCKED 讓兩次派送重疊時，後者直接跳過已被鎖住的列，
  // 而不是等待或重複取走——這是佇列取件的標準做法。也正因為有它，
  // cron 與 flushNotifications() 同時跑也不會把同一則送兩次。
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
      coach_id AS "coachId",
      payload,
      attempts
  `;

  if (claimed.length === 0) {
    return { reclaimed: reclaimed.count, claimed: 0, sent: 0, skipped: 0, failed: 0 };
  }

  const tally = { sent: 0, skipped: 0, failed: 0 };

  for (let i = 0; i < claimed.length; i += CONCURRENCY) {
    const batch = claimed.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(deliver));
    for (const outcome of results) tally[outcome]++;
  }

  return { reclaimed: reclaimed.count, claimed: claimed.length, ...tally };
}

/**
 * 在本次回應送出「之後」派送佇列，不讓使用者等 LINE API。
 *
 * 必須在 $transaction 之外呼叫：派送走的是另一條連線，交易還沒 commit 的話
 * 它看不到剛寫入的那幾列，會白跑一趟。
 *
 * 失敗只記 log 不往外拋——推播送不出去不該讓「取消課程」這個動作看起來失敗，
 * 而且那幾則仍留在佇列裡，下一次 cron 會再撿。
 */
export function flushNotifications(): void {
  after(async () => {
    try {
      await dispatchDue();
    } catch (err) {
      console.error("[flush] 即時派送失敗，留待下一次 cron", err);
    }
  });
}

type Outcome = "sent" | "skipped" | "failed";

async function deliver(n: Claimed): Promise<Outcome> {
  try {
    const text = await renderText(n);

    // 內容已無意義（例如課程在排入佇列後被取消）就標記完成，不送出。
    // 標記為 skipped 而非 sent：沒送出就沒計費，混進 sent 會讓後台的推播用量虛高。
    if (text === null) {
      await prisma.notification.update({
        where: { id: n.id },
        data: { status: "skipped", sentAt: new Date(), error: "內容已失效" },
      });
      return "skipped";
    }

    await lineClient().pushMessage({
      to: n.targetLineUserId,
      messages: [{ type: "text", text }],
    });

    await prisma.notification.update({
      where: { id: n.id },
      data: { status: "sent", sentAt: new Date(), error: null },
    });
    return "sent";
  } catch (err) {
    await handleFailure(n, err);
    return "failed";
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

    case "coach_booking":
      return n.sessionId ? renderCoachBooking(n.sessionId) : null;

    case "member_schedule":
      return renderMemberSchedule(
        n.coachId,
        n.payload as Parameters<typeof renderMemberSchedule>[1],
      );

    case "member_change":
      return renderMemberChange(
        n.payload as {
          kind?: string;
          leaveRequestId?: string;
          sessionId?: string;
          oldStartAt?: string;
        } | null,
      );
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
