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
