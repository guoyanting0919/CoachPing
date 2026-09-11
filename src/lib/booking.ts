import { overlaps } from "./schedule";
import { taipeiDateTime, ymd } from "./time";

/**
 * 學員預約的格子運算（SPEC.md §3.6）。
 *
 * 全部是純函式、不碰資料庫：可選時段的規則是這功能唯一真正複雜的地方，
 * 抽出來才能單獨驗證，也才不會在 API route 裡跟授權、交易糾纏在一起。
 */

/** 可預約時段的一段區間。weekday 0=週日 … 6=週六；分鐘自當日 00:00 起算（台北時間）。 */
export type Interval = { weekday: number; startMin: number; endMin: number };

/** 已被佔用的時間。教練自己的課，以及他當別人學員的課（雙重身分，SPEC.md §2）。 */
export type Busy = { startAt: Date; durationMin: number };

/** 封鎖時段（SPEC.md §3.7）。 */
export type Block = { startAt: Date; endAt: Date };

/** 學員能看到多遠。寫死不可設定——私教的排課視野短（SPEC.md §3.4）。 */
export const BOOKING_HORIZON_DAYS = 30;

/**
 * 候選開始時刻的間隔。格點是**絕對的**整點與半點（08:00, 08:30…），
 * 不是從區間起點往後推——學員的心智模型是鐘面。
 */
export const SLOT_STEP_MIN = 30;

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTES_PER_DAY = 24 * 60;

/** 某一天的可預約格子。date 為台北時區的 YYYY-MM-DD。 */
export type SlotDay = { date: string; starts: Date[] };

export type SlotInput = {
  availability: Interval[];
  blocks: Block[];
  busy: Busy[];
  /** 課程時長鎖定教練的預設值，學員不能選。 */
  durationMin: number;
  /** 最短提前時間。早於 now + 此值的格子不出現。 */
  leadHours: number;
  now: Date;
  horizonDays?: number;
};

/**
 * 算出未來 horizonDays 天內所有可預約的開始時刻，依日分組。
 * **只回傳有格子的日子**——學員端是「最近什麼時候有空」的清單，
 * 空的日子出現在畫面上只是雜訊（SPEC.md §3.6）。
 */
export function computeOpenSlots({
  availability,
  blocks,
  busy,
  durationMin,
  leadHours,
  now,
  horizonDays = BOOKING_HORIZON_DAYS,
}: SlotInput): SlotDay[] {
  if (availability.length === 0 || durationMin <= 0) return [];

  const earliest = new Date(now.getTime() + leadHours * 60 * 60 * 1000);

  // 日曆運算走 UTC 整數天再轉台北時刻，與 schedule.ts 一致——
  // 避免伺服器時區（Vercel 上是 UTC）影響日期判斷。
  const [y, m, d] = ymd(now).split("-").map(Number);
  const base = Date.UTC(y, m - 1, d);

  const byWeekday = new Map<number, Interval[]>();
  for (const iv of availability) {
    const list = byWeekday.get(iv.weekday);
    if (list) list.push(iv);
    else byWeekday.set(iv.weekday, [iv]);
  }

  const days: SlotDay[] = [];

  for (let i = 0; i < horizonDays; i++) {
    const dayStart = new Date(base + i * DAY_MS);
    const date = dayStart.toISOString().slice(0, 10);
    // dayStart 是「台北日曆日的 00:00」被當成 UTC 來表示，所以 getUTCDay()
    // 給的就是那個台北日期的星期幾，不受伺服器時區影響。
    const intervals = byWeekday.get(dayStart.getUTCDay());
    if (!intervals) continue;

    // 同一時刻可能落在兩段區間內（區間理應已正規化為互不重疊，但防禦性去重）。
    const seen = new Set<number>();
    const starts: Date[] = [];

    for (const iv of intervals) {
      // 對齊到絕對的整點／半點：區間從 08:15 開始時，第一個候選是 08:30。
      const first = Math.ceil(iv.startMin / SLOT_STEP_MIN) * SLOT_STEP_MIN;

      for (let min = first; min + durationMin <= iv.endMin; min += SLOT_STEP_MIN) {
        const startAt = taipeiDateTime(date, minToHHMM(min));
        if (seen.has(startAt.getTime())) continue;
        if (startAt < earliest) continue;
        if (blocks.some((b) => overlaps(startAt, durationMin, b.startAt, minutesBetween(b)))) {
          continue;
        }
        if (busy.some((s) => overlaps(startAt, durationMin, s.startAt, s.durationMin))) {
          continue;
        }
        seen.add(startAt.getTime());
        starts.push(startAt);
      }
    }

    if (starts.length === 0) continue;
    starts.sort((a, b) => a.getTime() - b.getTime());
    days.push({ date, starts });
  }

  return days;
}

function minutesBetween(b: Block): number {
  return (b.endAt.getTime() - b.startAt.getTime()) / 60_000;
}

/** 480 → "08:00" */
export function minToHHMM(min: number): string {
  const h = Math.floor(min / 60);
  return `${String(h).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** "08:00" → 480。格式不合回 null。 */
export function hhmmToMin(value: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * 正規化可預約時段：丟掉無效區間、依 weekday 分組排序、合併重疊與**相鄰**的區間。
 *
 * 相鄰也合併（8:00–12:00 加 12:00–18:00 變成 8:00–18:00）是刻意的：
 * 長度為零的休息不是休息，兩種寫法對格子運算完全等價，合併後資料只有一種形狀。
 * 教練在「個別調整」裡輸入相接的兩段後會看到它們併成一段——那不是 bug。
 */
export function normalizeIntervals(raw: Interval[]): Interval[] {
  const byWeekday = new Map<number, Interval[]>();

  for (const iv of raw) {
    if (!Number.isInteger(iv.weekday) || iv.weekday < 0 || iv.weekday > 6) continue;
    if (!Number.isInteger(iv.startMin) || !Number.isInteger(iv.endMin)) continue;
    if (iv.startMin < 0 || iv.endMin > MINUTES_PER_DAY) continue;
    if (iv.startMin >= iv.endMin) continue;

    const list = byWeekday.get(iv.weekday);
    if (list) list.push(iv);
    else byWeekday.set(iv.weekday, [iv]);
  }

  const out: Interval[] = [];

  for (const weekday of [...byWeekday.keys()].sort((a, b) => a - b)) {
    const sorted = byWeekday.get(weekday)!.sort((a, b) => a.startMin - b.startMin);
    let cur = { weekday, startMin: sorted[0].startMin, endMin: sorted[0].endMin };

    for (const iv of sorted.slice(1)) {
      if (iv.startMin <= cur.endMin) {
        cur.endMin = Math.max(cur.endMin, iv.endMin);
      } else {
        out.push(cur);
        cur = { weekday, startMin: iv.startMin, endMin: iv.endMin };
      }
    }
    out.push(cur);
  }

  return out;
}

/**
 * 共用版設定：勾幾個星期、一組起迄、一段休息。
 * 註冊表單只給這個形狀（SPEC.md §3.1），設定頁另有逐日的「個別調整」。
 */
export type SharedSetting = {
  weekdays: number[];
  startMin: number;
  endMin: number;
  /** 兩者皆為 null 表示不休息。 */
  breakStartMin: number | null;
  breakEndMin: number | null;
};

/** 註冊表單的預設值：週一～週五 09:00–21:00，休息 12:00–13:00。 */
export const DEFAULT_SHARED: SharedSetting = {
  weekdays: [1, 2, 3, 4, 5],
  startMin: 9 * 60,
  endMin: 21 * 60,
  breakStartMin: 12 * 60,
  breakEndMin: 13 * 60,
};

/** 共用版展開成扁平區間。休息完整落在區間內時切成兩段，否則忽略休息。 */
export function expandShared(s: SharedSetting): Interval[] {
  const hasBreak =
    s.breakStartMin !== null &&
    s.breakEndMin !== null &&
    s.breakStartMin < s.breakEndMin &&
    s.startMin < s.breakStartMin &&
    s.breakEndMin < s.endMin;

  return normalizeIntervals(
    s.weekdays.flatMap((weekday) =>
      hasBreak
        ? [
            { weekday, startMin: s.startMin, endMin: s.breakStartMin! },
            { weekday, startMin: s.breakEndMin!, endMin: s.endMin },
          ]
        : [{ weekday, startMin: s.startMin, endMin: s.endMin }],
    ),
  );
}

/**
 * 反向：扁平區間能否用共用版表達。能則回傳那組設定，不能回 null
 * （前端據此決定是開共用版還是直接展開「個別調整」）。
 *
 * 條件是每個有開放的星期都長得一模一樣，且該日最多兩段（兩段即一段休息）。
 */
export function toShared(intervals: Interval[]): SharedSetting | null {
  const normalized = normalizeIntervals(intervals);
  if (normalized.length === 0) return null;

  const byWeekday = new Map<number, Interval[]>();
  for (const iv of normalized) {
    const list = byWeekday.get(iv.weekday);
    if (list) list.push(iv);
    else byWeekday.set(iv.weekday, [iv]);
  }

  let shape: string | null = null;
  for (const list of byWeekday.values()) {
    if (list.length > 2) return null;
    const key = list.map((iv) => `${iv.startMin}-${iv.endMin}`).join(",");
    if (shape === null) shape = key;
    else if (shape !== key) return null;
  }

  const sample = [...byWeekday.values()][0];
  const weekdays = [...byWeekday.keys()].sort((a, b) => a - b);

  return sample.length === 1
    ? {
        weekdays,
        startMin: sample[0].startMin,
        endMin: sample[0].endMin,
        breakStartMin: null,
        breakEndMin: null,
      }
    : {
        weekdays,
        startMin: sample[0].startMin,
        endMin: sample[1].endMin,
        breakStartMin: sample[0].endMin,
        breakEndMin: sample[1].startMin,
      };
}

/**
 * 這些開始時刻有哪些沒有完整落在可預約時段內。
 * 教練自己排課時用來提示（**不阻擋**，SPEC.md §3.7）——教練是老闆，
 * 臨時跟熟客約在週日早上是常態。
 *
 * availability 為空時回傳空陣列：沒宣告過時段的教練不該每次排課都被提示。
 */
export function findOutsideAvailability(
  availability: Interval[],
  startTimes: Date[],
  durationMin: number,
): Date[] {
  if (availability.length === 0) return [];

  return startTimes.filter((startAt) => {
    const date = ymd(startAt);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const startMin = minutesFromMidnight(startAt, date);

    return !availability.some(
      (iv) =>
        iv.weekday === weekday &&
        startMin >= iv.startMin &&
        startMin + durationMin <= iv.endMin,
    );
  });
}

/** 這些開始時刻有哪些撞到封鎖時段。同樣只提示不阻擋。 */
export function findBlockedConflicts(
  blocks: Block[],
  startTimes: Date[],
  durationMin: number,
): Date[] {
  if (blocks.length === 0) return [];

  return startTimes.filter((startAt) =>
    blocks.some((b) => overlaps(startAt, durationMin, b.startAt, minutesBetween(b))),
  );
}

/** 台北時間下，該時刻距當日 00:00 幾分鐘。 */
function minutesFromMidnight(at: Date, date: string): number {
  return (at.getTime() - taipeiDateTime(date, "00:00").getTime()) / 60_000;
}
