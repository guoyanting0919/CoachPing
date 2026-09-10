import { fmt } from "../time";

/**
 * 後台的時間顯示（SPEC.md §16）。
 *
 * 稽核類欄位一律以絕對時間為主、相對時間為輔。純相對時間（「3 天前」）在後台是陷阱：
 * 沒辦法跟 log 或教練口述的時間對照。課程時間另外走 time.ts 的 fmtSession()，
 * 與教練端顯示的字串完全一致。
 */

export function fmtStamp(date: Date): string {
  return fmt(date, "yyyy-MM-dd HH:mm");
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 「3 天前」。只為這七八個字不值得引入 date-fns 的 locale。 */
export function relativeTime(date: Date, now = new Date()): string {
  const diff = now.getTime() - date.getTime();
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? "前" : "後";

  if (abs < MINUTE) return "剛剛";
  if (abs < HOUR) return `${Math.floor(abs / MINUTE)} 分鐘${suffix}`;
  if (abs < DAY) return `${Math.floor(abs / HOUR)} 小時${suffix}`;
  if (abs < 30 * DAY) return `${Math.floor(abs / DAY)} 天${suffix}`;
  if (abs < 365 * DAY) return `${Math.floor(abs / (30 * DAY))} 個月${suffix}`;
  return `${Math.floor(abs / (365 * DAY))} 年${suffix}`;
}

/** 「12 / 20（60%）」。已連結率這種比例值。 */
export function pct(part: number, total: number): string {
  if (total === 0) return "—";
  return `${Math.round((part / total) * 100)}%`;
}
