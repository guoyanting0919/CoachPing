import { messagingApi, validateSignature } from "@line/bot-sdk";
import { env } from "./env";

let client: messagingApi.MessagingApiClient | undefined;

export function lineClient(): messagingApi.MessagingApiClient {
  if (!client) {
    client = new messagingApi.MessagingApiClient({
      channelAccessToken: env().LINE_CHANNEL_ACCESS_TOKEN,
    });
  }
  return client;
}

/** 驗證 webhook 簽章。原始 body 字串不可經過 JSON.parse 再 stringify。 */
export function verifySignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  return validateSignature(rawBody, env().LINE_CHANNEL_SECRET, signature);
}

/** 回覆訊息。回覆免費，凡是能用 reply 的場合就不要用 push（SPEC.md §5）。 */
export async function replyText(replyToken: string, text: string): Promise<void> {
  await lineClient().replyMessage({
    replyToken,
    messages: [{ type: "text", text }],
  });
}

/**
 * Rich Menu 對應的角色。
 *
 * 「這個 LINE 使用者有哪些身分」不在這裡判斷——那是領域問題，見 lib/identity.ts。
 * 本模組只管 LINE 平台這一側：拿到一個角色，綁上對應的選單。
 */
export type Role = "coach" | "member" | "none" | "coach_dual" | "member_dual";

/**
 * Rich Menu 名稱，與 scripts/richmenu.ts 建立時使用的 name 一致。
 *
 * `*_dual` 兩張只綁給雙重身分者，選單上多一個切換鍵。一般教練與一般學員
 * 繼續拿原本的版面，不為一個罕見功能付版面代價（ADR-0001）。
 */
const MENU_NAME: Record<Role, string> = {
  coach: "coach",
  member: "member",
  none: "unregistered",
  coach_dual: "coach_dual",
  member_dual: "member_dual",
};

/** MENU_NAME 的反向查表，供 currentMenuRole 由選單名稱回推角色。 */
const ROLE_BY_MENU_NAME = new Map(
  (Object.keys(MENU_NAME) as Role[]).map((role) => [MENU_NAME[role], role]),
);

// Rich Menu 重建後 ID 會變。以名稱向 LINE 查詢而非寫在環境變數裡，
// 就不必每次改選單都同步更新環境變數（漏更新會讓新註冊的人拿不到選單）。
// 綁定只發生在註冊當下，一次冷啟動查一次的成本可以忽略。
let menuIdCache: Record<string, string> | undefined;

async function richMenuIds(): Promise<Record<string, string>> {
  if (menuIdCache) return menuIdCache;

  const list = await lineClient().getRichMenuList();
  menuIdCache = Object.fromEntries(
    list.richmenus.map((m) => [m.name, m.richMenuId]),
  );
  return menuIdCache;
}

/** 供測試或重建後清除快取。 */
export function clearRichMenuCache(): void {
  menuIdCache = undefined;
}

/**
 * 這個使用者目前綁的是哪張選單，也就是他當下在哪個模式。
 *
 * 「目前模式」的權威答案存在 LINE 而非資料庫（ADR-0001）：切換走客戶端的
 * richmenuswitch，webhook 收到回送的 postback 時把綁定同步過去，這裡就查得到。
 *
 * 查不到時回 null——沒綁過選單、選單剛重建導致快取過期、或 LINE 暫時不可用，
 * 都走這條。呼叫端必須自己決定退路，不要把 null 當成某個特定模式。
 */
export async function currentMenuRole(lineUserId: string): Promise<Role | null> {
  try {
    const { richMenuId } = await lineClient().getRichMenuIdOfUser(lineUserId);
    const ids = await richMenuIds();
    const name = Object.keys(ids).find((n) => ids[n] === richMenuId);
    return name ? (ROLE_BY_MENU_NAME.get(name) ?? null) : null;
  } catch (err) {
    // 未綁定任何選單時 LINE 回 404，這是正常情況，不值得吵。
    console.warn("[line] 查詢目前選單失敗", (err as Error).message);
    return null;
  }
}

/** 依角色綁定對應的 Rich Menu（SPEC.md §7）。 */
export async function bindRichMenu(lineUserId: string, role: Role): Promise<void> {
  const ids = await richMenuIds();
  const richMenuId = ids[MENU_NAME[role]];

  if (!richMenuId) {
    console.warn(`[line] 找不到名為 ${MENU_NAME[role]} 的 Rich Menu，略過綁定`);
    return;
  }

  await lineClient().linkRichMenuIdToUser(lineUserId, richMenuId);
}
