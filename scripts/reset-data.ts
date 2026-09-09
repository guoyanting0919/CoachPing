/**
 * 清空所有業務資料，回到全新狀態。開發／測試環境專用。
 *
 *   npx tsx --env-file=.env scripts/reset-data.ts          # 只顯示將刪除的內容
 *   npx tsx --env-file=.env scripts/reset-data.ts --yes    # 實際執行
 *
 * ⚠️ 不可逆。正式環境有真實教練後絕對不要執行。
 */
import { bindRichMenu } from "../src/lib/line";
import { prisma } from "../src/lib/prisma";

async function summarize() {
  const [coaches, members, links, sessions, participants, leaves, notifications, invites, coachInvites] =
    await Promise.all([
      prisma.coach.count(),
      prisma.member.count(),
      prisma.coachMember.count(),
      prisma.session.count(),
      prisma.sessionParticipant.count(),
      prisma.leaveRequest.count(),
      prisma.notification.count(),
      prisma.invite.count(),
      prisma.coachInvite.count(),
    ]);

  console.log("\n將刪除：");
  for (const [name, n] of [
    ["coaches", coaches],
    ["members", members],
    ["coach_members", links],
    ["sessions", sessions],
    ["session_participants", participants],
    ["leave_requests", leaves],
    ["notifications", notifications],
    ["invites", invites],
    ["coach_invites", coachInvites],
  ] as const) {
    console.log(`  ${name.padEnd(22)} ${n}`);
  }

  return { coaches, members };
}

async function main() {
  await summarize();

  if (!process.argv.includes("--yes")) {
    console.log("\n未加 --yes，不執行任何刪除。\n");
    return;
  }

  // 先收集受影響的 LINE 使用者，刪完才有辦法把他們的選單切回未註冊——
  // 否則他們手機上會留著一個點了會出錯的選單。
  const lineUserIds = [
    ...(await prisma.coach.findMany({ select: { lineUserId: true } })).map((c) => c.lineUserId),
    ...(await prisma.member.findMany({
      where: { lineUserId: { not: null } },
      select: { lineUserId: true },
    })).map((m) => m.lineUserId!),
  ].filter((id) => !id.startsWith("detached:"));

  // 依外鍵相依順序刪除。
  await prisma.notification.deleteMany();
  await prisma.leaveRequest.deleteMany();
  await prisma.sessionParticipant.deleteMany();
  await prisma.session.deleteMany();
  await prisma.invite.deleteMany();
  await prisma.coachInvite.deleteMany();
  await prisma.coachMember.deleteMany();
  await prisma.member.deleteMany();
  await prisma.coach.deleteMany();

  console.log("\n✓ 資料已清空");

  for (const id of new Set(lineUserIds)) {
    await bindRichMenu(id, "none").catch((e) =>
      console.warn(`  ${id} 選單切換失敗:`, (e as Error).message),
    );
  }
  console.log(`✓ 已將 ${new Set(lineUserIds).size} 位使用者的選單切回「完成註冊」\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
