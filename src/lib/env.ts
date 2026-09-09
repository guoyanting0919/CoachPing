import { z } from "zod";

/**
 * 伺服器端環境變數。以 lazy 方式驗證，避免 build 階段（無 secrets）直接失敗。
 * 用戶端變數必須以 NEXT_PUBLIC_ 前綴直接引用，不能經過這裡。
 */
const serverSchema = z.object({
  DATABASE_URL: z.string().min(1),
  LINE_CHANNEL_SECRET: z.string().min(1),
  LINE_CHANNEL_ACCESS_TOKEN: z.string().min(1),

  // LINE Login channel 的 Channel ID。驗證 LIFF ID token 時必須帶入，
  // 否則無法確認 token 是簽給本應用的。
  LINE_LOGIN_CHANNEL_ID: z.string().min(1),

  APP_BASE_URL: z.url(),
  CRON_SECRET: z.string().min(1),

  // Rich Menu 於第 2 項建立後才會有值，故為選填。
  LINE_RICHMENU_UNREGISTERED: z.string().optional(),
  LINE_RICHMENU_COACH: z.string().optional(),
  LINE_RICHMENU_MEMBER: z.string().optional(),
});

type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | undefined;

export function env(): ServerEnv {
  if (cached) return cached;

  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("\n  ");
    throw new Error(`環境變數設定有誤，請對照 .env.example：\n  ${missing}`);
  }

  cached = parsed.data;
  return cached;
}
