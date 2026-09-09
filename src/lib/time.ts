import { formatInTimeZone, toZonedTime, fromZonedTime } from "date-fns-tz";

/** 全系統單一時區，不做多時區（SPEC.md §4）。 */
export const TZ = "Asia/Taipei";

/** 以台北時間格式化。例：fmt(d, "M/d (EEEEE) HH:mm") */
export function fmt(date: Date, pattern: string): string {
  return formatInTimeZone(date, TZ, pattern);
}

/** UTC Date → 台北牆上時間的 Date（僅供取 getHours 等本地欄位用）。 */
export function toTaipei(date: Date): Date {
  return toZonedTime(date, TZ);
}

/** 台北牆上時間 → 正確的 UTC Date。排課時把使用者輸入轉成儲存值。 */
export function fromTaipei(wallClock: Date): Date {
  return fromZonedTime(wallClock, TZ);
}

/**
 * 由台北時間的年月日時分組出 UTC Date。
 * 排課 UI 傳來的是 "2026-10-14" + "19:00" 這種字串。
 */
export function taipeiDateTime(dateStr: string, timeStr: string): Date {
  return fromZonedTime(`${dateStr}T${timeStr}:00`, TZ);
}

const WEEKDAY_ZH = ["日", "一", "二", "三", "四", "五", "六"] as const;

/** 中文星期。date-fns 的中文 locale 只為了這七個字不值得引入。 */
export function weekdayZh(date: Date): string {
  return WEEKDAY_ZH[Number(fmt(date, "i")) % 7];
}

/** 「10/14 (二) 19:00」 */
export function fmtSession(date: Date): string {
  return `${fmt(date, "M/d")} (${weekdayZh(date)}) ${fmt(date, "HH:mm")}`;
}

/** 台北時區下的 YYYY-MM-DD。 */
export function ymd(date: Date): string {
  return fmt(date, "yyyy-MM-dd");
}

/** 「12:00–13:30」。只顯示開始時間，教練得自己心算課上到幾點。 */
export function fmtTimeRange(start: Date, durationMin: number): string {
  const end = new Date(start.getTime() + durationMin * 60_000);
  return `${fmt(start, "HH:mm")}–${fmt(end, "HH:mm")}`;
}

/** 「9/12」 */
export function fmtMonthDay(ymdStr: string): string {
  const [, m, d] = ymdStr.split("-");
  return `${Number(m)}/${Number(d)}`;
}
