/** 月曆／週曆的日期格運算。全程走 UTC 整數天，只處理 YYYY-MM-DD 字串。 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** 該月的日曆格，以星期一為首補滿前後空白，長度必為 7 的倍數。 */
export function monthGrid(anchor: string): string[] {
  const [y, m] = anchor.split("-").map(Number);
  const first = Date.UTC(y, m - 1, 1);
  const last = Date.UTC(y, m, 0);

  const leading = (new Date(first).getUTCDay() + 6) % 7;
  const trailing = 6 - ((new Date(last).getUTCDay() + 6) % 7);

  const start = first - leading * DAY_MS;
  const total = leading + new Date(last).getUTCDate() + trailing;

  return Array.from({ length: total }, (_, i) =>
    new Date(start + i * DAY_MS).toISOString().slice(0, 10),
  );
}

export function shiftMonth(anchor: string, delta: number): string {
  const [y, m] = anchor.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7) + "-01";
}

/** 該日所在的一週（星期一為首）。 */
export function weekOf(anchor: string): string[] {
  const [y, m, d] = anchor.split("-").map(Number);
  const base = Date.UTC(y, m - 1, d);
  const monday = base - ((new Date(base).getUTCDay() + 6) % 7) * DAY_MS;
  return Array.from({ length: 7 }, (_, i) =>
    new Date(monday + i * DAY_MS).toISOString().slice(0, 10),
  );
}

export function shiftWeek(anchor: string, weeks: number): string {
  const [y, m, d] = anchor.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + weeks * 7 * DAY_MS).toISOString().slice(0, 10);
}

/** 該月的第一天，用於當月曆的錨點。 */
export function monthAnchor(ymdStr: string): string {
  return ymdStr.slice(0, 7) + "-01";
}
