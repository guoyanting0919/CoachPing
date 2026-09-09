import { taipeiDateTime } from "./time";

/**
 * 重複課程展開成實體 session（SPEC.md §3.4、決策記錄）。
 * 這裡只負責算出「哪些時間點要開課」，不碰資料庫，方便單獨驗證。
 */

export type GenerateInput = {
  /** 起始日，台北時間的 YYYY-MM-DD。 */
  startDate: string;
  /** 0=週日 … 6=週六。空陣列代表單次課程，只在 startDate 開一堂。 */
  weekdays: number[];
  /** HH:mm，台北時間。 */
  time: string;
  /** 每個星期幾各要生成幾週。單次課程忽略此值。 */
  weeks: number;
};

/** YYYY-MM-DD → 該日期的 UTC 午夜。只拿來做日曆天數運算，不是實際開課時間。 */
function ymdToUtc(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function utcToYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 回傳每一堂課的開始時刻（UTC Date，可直接存進 sessions.start_at）。
 *
 * 每個選定的星期幾各自從「startDate 當天或之後最近的那一天」起算，
 * 往後每 7 天一堂、共 weeks 堂。所以總堂數 = weekdays.length × weeks，
 * 且一定不會早於 startDate。
 *
 * 日曆運算全程走 UTC 整數天，台灣無日光節約，最後才轉成台北時刻，
 * 避免伺服器時區（Vercel 上是 UTC）影響星期幾的判斷。
 */
export function generateStartTimes(input: GenerateInput): Date[] {
  const { startDate, weekdays, time, weeks } = input;

  if (weekdays.length === 0) {
    return [taipeiDateTime(startDate, time)];
  }

  const start = ymdToUtc(startDate);
  const result: Date[] = [];

  for (const weekday of weekdays) {
    // 從 startDate 起算，往後推到第一個符合的星期幾（可能就是當天）。
    const offset = (weekday - start.getUTCDay() + 7) % 7;
    const first = start.getTime() + offset * DAY_MS;

    for (let w = 0; w < weeks; w++) {
      result.push(taipeiDateTime(utcToYmd(new Date(first + w * 7 * DAY_MS)), time));
    }
  }

  return result.sort((a, b) => a.getTime() - b.getTime());
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

/** 預設展開週數（SPEC.md §3.4：維持未來 12 週）。 */
export const DEFAULT_WEEKS = 12;
export const MAX_WEEKS = 26;
/** 一堂課最多 3 人：1 對 1、1 對 2、1 對 3，不做團體課（SPEC.md §4）。 */
export const MAX_PARTICIPANTS = 3;
