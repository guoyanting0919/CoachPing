/** 預約格子邏輯的手動驗證。npx tsx scripts/check-booking.ts */
import {
  computeOpenSlots,
  expandShared,
  findBlockedConflicts,
  findOutsideAvailability,
  minToHHMM,
  normalizeIntervals,
  toShared,
  type Interval,
} from "../src/lib/booking";
import { fmt, fmtSession, taipeiDateTime } from "../src/lib/time";

/** 台北時間 2026-09-09（週三）08:00。 */
const NOW = taipeiDateTime("2026-09-09", "08:00");

function slots(
  title: string,
  opts: {
    availability: Interval[];
    durationMin?: number;
    leadHours?: number;
    blocks?: { startAt: Date; endAt: Date }[];
    busy?: { startAt: Date; durationMin: number }[];
    days?: number;
  },
) {
  const days = computeOpenSlots({
    availability: opts.availability,
    blocks: opts.blocks ?? [],
    busy: opts.busy ?? [],
    durationMin: opts.durationMin ?? 60,
    leadHours: opts.leadHours ?? 0,
    now: NOW,
    horizonDays: opts.days ?? 2,
  });

  console.log(`\n${title}`);
  if (days.length === 0) console.log("   （沒有可預約時段）");
  for (const d of days) {
    console.log(`   ${d.date}  ${d.starts.map((s) => fmt(s, "HH:mm")).join(" ")}`);
  }
}

// 8:00–18:00 休息 12:00–13:00 = 兩段。8:00 已過（now 正好 08:00，不早於 now 故保留）。
const wed = expandShared({
  weekdays: [3],
  startMin: 8 * 60,
  endMin: 18 * 60,
  breakStartMin: 12 * 60,
  breakEndMin: 13 * 60,
});

slots(
  "週三 8:00–18:00 休息 12:00–13:00，60 分鐘課 —— 11:00 之後應直接跳到 13:00，" +
    "且 11:30 不出現（會壓到休息）",
  { availability: wed },
);

slots(
  "同上但 45 分鐘課 —— 11:30 仍不出現（11:30–12:15 會壓到休息），" +
    "17:30 也不出現（17:30–18:15 超出 18:00）",
  { availability: wed, durationMin: 45 },
);

// SPEC.md §3.6 提到的「格子會互相吃掉」：時長不是 30 的倍數時必然發生，是正確行為。
slots(
  "45 分鐘課、8:00 已被約走 —— 08:30 應消失（8:00–8:45 壓到它），09:00 保留",
  {
    availability: [{ weekday: 3, startMin: 8 * 60, endMin: 11 * 60 }],
    durationMin: 45,
    busy: [{ startAt: taipeiDateTime("2026-09-09", "08:00"), durationMin: 45 }],
  },
);

slots(
  "區間從 08:15 起 —— 第一個格子應是 08:30（絕對半點，不是 08:15）",
  { availability: [{ weekday: 3, startMin: 8 * 60 + 15, endMin: 12 * 60 }] },
);

slots("最短提前 6 小時（now 為 08:00）—— 14:00 之前的格子應全部消失", {
  availability: wed,
  leadHours: 6,
});

slots("封鎖 9/9 09:00–11:00 —— 09:00、10:00 消失，08:00 與 11:00 保留", {
  availability: wed,
  blocks: [
    { startAt: taipeiDateTime("2026-09-09", "09:00"), endAt: taipeiDateTime("2026-09-09", "11:00") },
  ],
});

slots("已有一堂 10:00 的課 —— 09:30、10:00、10:30 應全部消失（60 分鐘互相重疊）", {
  availability: [{ weekday: 3, startMin: 8 * 60, endMin: 14 * 60 }],
  busy: [{ startAt: taipeiDateTime("2026-09-09", "10:00"), durationMin: 60 }],
});

slots("沒有任何可預約時段", { availability: [] });

console.log("\n正規化：");
const messy: Interval[] = [
  { weekday: 1, startMin: 540, endMin: 720 },
  { weekday: 1, startMin: 720, endMin: 1080 }, // 相鄰 → 應合併成 540–1080
  { weekday: 2, startMin: 600, endMin: 700 },
  { weekday: 2, startMin: 650, endMin: 800 }, // 重疊 → 應合併成 600–800
  { weekday: 3, startMin: 600, endMin: 600 }, // 長度 0 → 丟掉
  { weekday: 9, startMin: 0, endMin: 60 }, // 星期無效 → 丟掉
];
for (const iv of normalizeIntervals(messy)) {
  console.log(`   weekday ${iv.weekday}  ${minToHHMM(iv.startMin)}–${minToHHMM(iv.endMin)}`);
}

console.log("\n共用版 ↔ 扁平區間：");
console.log("   有休息 →", JSON.stringify(toShared(wed)));
console.log(
  "   逐日不同（週三只有晚上）→",
  JSON.stringify(
    toShared([
      { weekday: 1, startMin: 540, endMin: 1080 },
      { weekday: 3, startMin: 1140, endMin: 1260 },
    ]),
  ),
  "← 應為 null（共用版表達不了，前端會直接開個別調整）",
);

console.log("\n教練自己排課的提示（不阻擋）：");
const outside = findOutsideAvailability(
  wed,
  [taipeiDateTime("2026-09-09", "19:00"), taipeiDateTime("2026-09-09", "09:00")],
  60,
);
console.log("   19:00（超出 18:00）與 09:00（在範圍內）→ 只有前者該被列出：");
for (const d of outside) console.log("     ", fmtSession(d));

console.log("   沒宣告過時段的教練 →", findOutsideAvailability([], [NOW], 60).length, "筆（應為 0）");

const blocked = findBlockedConflicts(
  [{ startAt: taipeiDateTime("2026-09-09", "09:00"), endAt: taipeiDateTime("2026-09-09", "11:00") }],
  [taipeiDateTime("2026-09-09", "10:30"), taipeiDateTime("2026-09-09", "15:00")],
  60,
);
console.log("   封鎖 09:00–11:00，排 10:30 與 15:00 → 只有前者該被列出：");
for (const d of blocked) console.log("     ", fmtSession(d));
