/** 排課生成邏輯的手動驗證。npx tsx scripts/check-schedule.ts */
import { generateStartTimes, overlaps } from "../src/lib/schedule";
import { fmtSession } from "../src/lib/time";

function show(title: string, dates: Date[]) {
  console.log(`\n${title}  共 ${dates.length} 堂`);
  for (const d of dates) console.log("  ", fmtSession(d));
}

show("單堂：9/9 19:00", generateStartTimes({ startDate: "2026-09-09", time: "19:00", weeks: 1 }));

show(
  "9/9（週三）起連續 3 週 19:00 —— 應為 9/9、9/16、9/23，全部是週三",
  generateStartTimes({ startDate: "2026-09-09", time: "19:00", weeks: 3 }),
);

show(
  "跨月：9/29（週二）起連續 3 週 07:30",
  generateStartTimes({ startDate: "2026-09-29", time: "07:30", weeks: 3 }),
);

console.log("\n重疊判斷：");
const a = new Date("2026-09-09T11:00:00Z"); // 台北 19:00
console.log("  60分 vs 30分後開始的60分 →", overlaps(a, 60, new Date(a.getTime() + 30 * 60000), 60));
console.log("  60分 vs 60分後開始的60分 →", overlaps(a, 60, new Date(a.getTime() + 60 * 60000), 60));
