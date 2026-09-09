/**
 * 推播佇列的檢視與補排。
 *
 *   npx tsx --env-file=.env scripts/notifications.ts status
 *   npx tsx --env-file=.env scripts/notifications.ts backfill
 *
 * backfill 為「已建立但尚未排入提醒」的未來課程補上提醒——
 * 佇列功能上線前建立的課程需要跑一次。
 */
import { enqueueSessionReminders, renderMemberReminder } from "../src/lib/notifications";
import { prisma } from "../src/lib/prisma";
import { fmtSession } from "../src/lib/time";

async function status() {
  const rows = await prisma.notification.groupBy({
    by: ["status", "type"],
    _count: true,
  });

  console.log("\n佇列狀態：");
  if (rows.length === 0) console.log("  （空）");
  for (const r of rows) console.log(`  ${r.status.padEnd(8)} ${r.type.padEnd(18)} ${r._count}`);

  const upcoming = await prisma.notification.findMany({
    where: { status: "pending" },
    orderBy: { sendAt: "asc" },
    take: 10,
    select: { id: true, type: true, sendAt: true, sessionId: true },
  });

  console.log("\n最近待送出的 10 筆：");
  if (upcoming.length === 0) console.log("  （無）");
  for (const n of upcoming) {
    console.log(`  ${fmtSession(n.sendAt)}  ${n.type}`);
  }

  // 實際會送出的內容，確認文案沒問題。
  const sample = upcoming[0];
  if (sample?.sessionId) {
    console.log("\n第一筆的訊息內容預覽：\n");
    console.log((await renderMemberReminder(sample.sessionId)) ?? "（內容已失效）");
  }
  console.log();
}

async function backfill() {
  const withoutReminder = await prisma.session.findMany({
    where: {
      status: "scheduled",
      startAt: { gt: new Date() },
      notifications: { none: { type: "member_reminder" } },
    },
    select: { id: true },
  });

  if (withoutReminder.length === 0) {
    console.log("沒有需要補排的課程。");
    return;
  }

  const count = await enqueueSessionReminders(
    prisma,
    withoutReminder.map((s) => s.id),
  );
  console.log(`已為 ${withoutReminder.length} 堂課補排 ${count} 則提醒。`);
  console.log("（未連結 LINE 的學員沒有提醒，需要教練手動通知。）");
}

const actions: Record<string, () => Promise<void>> = { status, backfill };

(actions[process.argv[2]] ??
  (async () => {
    console.error("用法: notifications.ts status|backfill");
    process.exit(1);
  }))()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
