/** 排課生成邏輯的手動驗證。npx tsx scripts/check-schedule.ts */
import { generateStartTimes, overlaps } from "../src/lib/schedule";
import { fmtSession } from "../src/lib/time";

function show(title: string, dates: Date[]) {
  console.log(`\n${title}  共 ${dates.length} 堂`);
  for (const d of dates.slice(0, 8)) console.log("  ", fmtSession(d));
  if (dates.length > 8) console.log(`   … 其餘 ${dates.length - 8} 堂`);
}

// 2026-09-09 是星期三
show(
  "單次：9/9 19:00",
  generateStartTimes({ startDate: "2026-09-09", weekdays: [], time: "19:00", weeks: 1 }),
);

show(
  "每週二、四 19:00，共 4 週（起始 9/9 週三）",
  generateStartTimes({ startDate: "2026-09-09", weekdays: [2, 4], time: "19:00", weeks: 4 }),
);

show(
  "每週三 07:30，共 3 週（起始日就是週三，應含當天）",
  generateStartTimes({ startDate: "2026-09-09", weekdays: [3], time: "07:30", weeks: 3 }),
);

console.log("\n重疊判斷：");
const a = new Date("2026-09-09T11:00:00Z"); // 台北 19:00
console.log("  60分 vs 30分後開始的60分 →", overlaps(a, 60, new Date(a.getTime() + 30 * 60000), 60));
console.log("  60分 vs 60分後開始的60分 →", overlaps(a, 60, new Date(a.getTime() + 60 * 60000), 60));
