import { taipeiDateTime } from "./time";

/**
 * 重複課程展開成實體 session（SPEC.md §3.4）。
 * 這裡只負責算出「哪些時間點要開課」，不碰資料庫，方便單獨驗證。
 */

export type GenerateInput = {
  /** 首堂日期，台北時間的 YYYY-MM-DD。星期幾由這個日期決定。 */
  startDate: string;
  /** HH:mm，台北時間。 */
  time: string;
  /** 連續幾週。1 = 單堂課程。 */
  weeks: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 回傳每一堂課的開始時刻（UTC Date，可直接存進 sessions.start_at）。
 *
 * 從 startDate 當天開始，往後每 7 天一堂、共 weeks 堂。
 * 刻意不提供「選星期幾」：使用者同時指定日期與星期幾時兩者必然會對不起來
 * （例如在週三的日期上選「每週二」），星期幾由所選日期決定才直觀。
 *
 * 日曆運算走 UTC 整數天，最後才轉台北時刻，避免伺服器時區
 * （Vercel 上是 UTC）影響日期判斷。台灣無日光節約，加 7 天恆等於下一週同一天。
 */
export function generateStartTimes({ startDate, time, weeks }: GenerateInput): Date[] {
  const [y, m, d] = startDate.split("-").map(Number);
  const base = Date.UTC(y, m - 1, d);

  return Array.from({ length: Math.max(1, weeks) }, (_, i) =>
    taipeiDateTime(new Date(base + i * 7 * DAY_MS).toISOString().slice(0, 10), time),
  );
}

/** 兩堂課是否時間重疊。用於偵測教練自己撞課。 */
export function overlaps(
  aStart: Date,
  aMinutes: number,
  bStart: Date,
  bMinutes: number,
): boolean {
  const aEnd = aStart.getTime() + aMinutes * 60_000;
  const bEnd = bStart.getTime() + bMinutes * 60_000;
  return aStart.getTime() < bEnd && bStart.getTime() < aEnd;
}

/** 預設單堂，不重複。 */
export const DEFAULT_WEEKS = 1;
export const MAX_WEEKS = 12;
/** 重複的可選週數。1 另外以「單堂課程」呈現，不列在這裡。 */
export const WEEK_OPTIONS = Array.from({ length: MAX_WEEKS - 1 }, (_, i) => i + 2);
/** 一堂課最多 3 人：1 對 1、1 對 2、1 對 3，不做團體課（SPEC.md §4）。 */
export const MAX_PARTICIPANTS = 3;

/**
 * 該日期是否早於今天（台北時間）。課程不能排到過去——
 * 排了也沒有意義，通知不會發、學員也回不到過去。
 */
export function isPastDate(ymdStr: string, today: string): boolean {
  return ymdStr < today;
}
