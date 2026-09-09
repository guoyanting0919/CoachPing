import type { webhook } from "@line/bot-sdk";
import { bindRichMenu, replyText, resolveRole, verifySignature } from "@/lib/line";
import { prisma } from "@/lib/prisma";
import { buildCoachTodayText } from "@/lib/today-schedule";

export const runtime = "nodejs";
// webhook 必須每次即時處理，不可被快取或預先產生。
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  // 簽章驗證需要未經處理的原始 body，不能先 JSON.parse。
  const rawBody = await req.text();

  if (!verifySignature(rawBody, req.headers.get("x-line-signature"))) {
    return new Response("Invalid signature", { status: 401 });
  }

  const { events } = JSON.parse(rawBody) as { events: webhook.Event[] };

  // 除錯用：Vercel Logs 中看到這行即代表 LINE 確實打到了本端點且簽章正確。
  console.log(
    `[webhook] 收到 ${events.length} 個事件:`,
    events.map((e) => e.type).join(", "),
  );

  // LINE 要求 webhook 快速回應，且失敗會重送。逐一處理但吞掉個別錯誤，
  // 避免一個事件的失敗導致整批重送造成重複推播。
  await Promise.all(
    events.map(async (event) => {
      try {
        await handleEvent(event);
      } catch (err) {
        // 例如 access token 失效導致 reply 失敗。必須印出完整內容，
        // 否則會靜默吞掉——使用者只會看到「沒有任何回覆」。
        console.error("[webhook] 事件處理失敗", event.type, err);
      }
    }),
  );

  return new Response("OK", { status: 200 });
}

async function handleEvent(event: webhook.Event): Promise<void> {
  // 群組／聊天室事件沒有 userId，本系統只處理一對一。
  const lineUserId = event.source?.userId;
  if (!lineUserId) return;

  switch (event.type) {
    case "follow":
      if (!event.replyToken) return;
      return handleFollow(lineUserId, event.replyToken);

    case "unfollow":
      return handleUnfollow(lineUserId);

    case "message":
      if (event.message.type !== "text" || !event.replyToken) return;
      return handleTextMessage(lineUserId, event.replyToken, event.message.text);

    case "postback":
      if (!event.replyToken) return;
      return handlePostback(lineUserId, event.replyToken, event.postback.data);

    default:
      return;
  }
}

/** Rich Menu 的 postback 按鈕。回覆一律用 reply（免費），不佔推播額度。 */
async function handlePostback(
  lineUserId: string,
  replyToken: string,
  data: string,
): Promise<void> {
  const action = new URLSearchParams(data).get("action");

  if (action === "today") {
    const coach = await prisma.coach.findUnique({
      where: { lineUserId },
      select: { id: true },
    });
    if (!coach) {
      await replyText(replyToken, "這個功能只有教練可以使用。");
      return;
    }
    await replyText(replyToken, await buildCoachTodayText(coach.id));
    return;
  }

  console.warn("[webhook] 未知的 postback action:", data);
}

async function handleFollow(lineUserId: string, replyToken: string): Promise<void> {
  // 曾經封鎖後又重新加入好友，解除封鎖標記。
  await prisma.member.updateMany({
    where: { lineUserId, lineBlocked: true },
    data: { lineBlocked: false },
  });

  const role = await resolveRole(lineUserId);
  await bindRichMenu(lineUserId, role);

  const text =
    role === "none"
      ? "歡迎加入！請點下方選單完成註冊，之後就能收到上課提醒。"
      : "歡迎回來！下方選單已就緒。";

  await replyText(replyToken, text);
}

async function handleUnfollow(lineUserId: string): Promise<void> {
  // 封鎖後推播必然失敗，先行標記讓教練端顯示警示（SPEC.md §5）。
  await prisma.member.updateMany({
    where: { lineUserId },
    data: { lineBlocked: true },
  });
}

/** 教練打這些字也能查今日課表，不必一定要點選單。 */
const TODAY_KEYWORDS = ["今日課表", "今天課表", "課表", "今日"];

async function handleTextMessage(
  lineUserId: string,
  replyToken: string,
  message: string,
): Promise<void> {
  const role = await resolveRole(lineUserId);

  if (role === "coach" && TODAY_KEYWORDS.includes(message.trim())) {
    const coach = await prisma.coach.findUnique({
      where: { lineUserId },
      select: { id: true },
    });
    if (coach) {
      await replyText(replyToken, await buildCoachTodayText(coach.id));
      return;
    }
  }

  // 一律使用 reply（免費），不要用 push 回應學員訊息。
  const text =
    role === "coach"
      ? "請點下方選單操作排課、查看學員或處理請假。也可以直接輸入「今日課表」。"
      : role === "member"
        ? "課表查詢與請假請點下方選單。想找教練聊聊請點「聯絡教練」。"
        : "請先點下方選單完成註冊。";

  await replyText(replyToken, text);
}
