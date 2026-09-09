import { messagingApi, validateSignature } from "@line/bot-sdk";
import { env } from "./env";
import { prisma } from "./prisma";

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

export type Role = "coach" | "member" | "none";

/** 依 LINE userId 判斷角色。教練優先（MVP 不處理同一人身兼兩角）。 */
export async function resolveRole(lineUserId: string): Promise<Role> {
  const coach = await prisma.coach.findUnique({
    where: { lineUserId },
    select: { id: true },
  });
  if (coach) return "coach";

  const member = await prisma.member.findUnique({
    where: { lineUserId },
    select: { id: true },
  });
  if (member) return "member";

  return "none";
}

/** Rich Menu 名稱，與 scripts/richmenu.ts 建立時使用的 name 一致。 */
const MENU_NAME: Record<Role, string> = {
  coach: "coach",
  member: "member",
  none: "unregistered",
};

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
