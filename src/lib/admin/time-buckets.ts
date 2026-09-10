import { fmt, taipeiDateTime, ymd } from "../time";

/**
 * 推播計費統計的時間桶（SPEC.md §16）。
 *
 * 一律以 sentAt 切——那是實際送出、也就是實際計費的時刻。用 createdAt 會錯：
 * 課前提醒可能在排課當下就入佇列，幾天後才送出。
 *
 * 「本月」用自然月而非過去 30 天：LINE 的免費額度按自然月重算，
 * 用滾動 30 天算出來的數字跟帳單永遠對不起來。
 */

/** 台北時區下、daysAgo 天前那一天的 00:00（回傳 UTC Date）。 */
export function taipeiMidnight(daysAgo: number, now = new Date()): Date {
  const d = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  return taipeiDateTime(ymd(d), "00:00");
}

/** 台北時區下本月 1 日的 00:00。 */
export function taipeiMonthStart(now = new Date()): Date {
  return taipeiDateTime(`${fmt(now, "yyyy-MM")}-01`, "00:00");
}

export type Bucket = "yesterday" | "last7" | "month" | "total";

export const BUCKET_LABELS: Record<Bucket, string> = {
  yesterday: "昨天",
  last7: "過去 7 天",
  month: "本月",
  total: "總計",
};

export const BUCKETS: Bucket[] = ["yesterday", "last7", "month", "total"];

export type BucketRange = { gte?: Date; lt?: Date };

/**
 * 「過去 7 天」指 7 個完整的日，不含今天——今天還沒過完，
 * 跟昨天併排比較會誤導。
 */
export function bucketRanges(now = new Date()): Record<Bucket, BucketRange> {
  const todayStart = taipeiMidnight(0, now);

  return {
    yesterday: { gte: taipeiMidnight(1, now), lt: todayStart },
    last7: { gte: taipeiMidnight(7, now), lt: todayStart },
    month: { gte: taipeiMonthStart(now) },
    total: {},
  };
}

export type BucketCounts = Record<Bucket, number>;

export const ZERO_COUNTS: BucketCounts = {
  yesterday: 0,
  last7: 0,
  month: 0,
  total: 0,
};
