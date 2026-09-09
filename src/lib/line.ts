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

/**
 * 依角色綁定對應的 Rich Menu（SPEC.md §7）。
 * Rich Menu 於第 2 項才建立，環境變數未設定時靜默略過，不阻斷註冊流程。
 */
export async function bindRichMenu(lineUserId: string, role: Role): Promise<void> {
  const e = env();
  const richMenuId =
    role === "coach"
      ? e.LINE_RICHMENU_COACH
      : role === "member"
        ? e.LINE_RICHMENU_MEMBER
        : e.LINE_RICHMENU_UNREGISTERED;

  if (!richMenuId) {
    console.warn(`[line] Rich Menu 未設定，略過綁定 (role=${role})`);
    return;
  }

  await lineClient().linkRichMenuIdToUser(lineUserId, richMenuId);
}
