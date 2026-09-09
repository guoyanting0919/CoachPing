/**
 * 開發用：暫時解除自己的教練身分，以便用同一個 LINE 帳號測試學員流程。
 *
 * LINE 帳號綁定手機號碼，取得第二個帳號成本高。此腳本讓單一帳號可以
 * 依序走完教練端與學員端，測完再切回來。
 *
 *   npx tsx --env-file=.env scripts/dev-role.ts status
 *   npx tsx --env-file=.env scripts/dev-role.ts detach   # 變成「未註冊」，可走學員註冊流程
 *   npx tsx --env-file=.env scripts/dev-role.ts restore  # 切回教練
 *
 * ⚠️ 僅供開發環境使用。
 */
import { readFile, writeFile, unlink } from "node:fs/promises";
import { prisma } from "../src/lib/prisma";
import { bindRichMenu } from "../src/lib/line";

const STASH = ".dev-role-stash.json";

async function status() {
  const coaches = await prisma.coach.findMany({
    select: { id: true, name: true, lineUserId: true },
  });
  const members = await prisma.member.findMany({
    where: { lineUserId: { not: null } },
    select: { id: true, displayName: true, lineUserId: true },
  });

  console.log("\n教練：");
  for (const c of coaches) {
    const detached = c.lineUserId.startsWith("detached:");
    console.log(`  ${c.name}  ${detached ? "（已解除綁定）" : c.lineUserId}`);
  }
  console.log("\n已連結的學員：");
  if (!members.length) console.log("  （無）");
  for (const m of members) console.log(`  ${m.displayName}  ${m.lineUserId}`);
  console.log();
}

async function detach() {
  const coach = await prisma.coach.findFirst({
    where: { NOT: { lineUserId: { startsWith: "detached:" } } },
  });
  if (!coach) {
    console.error("找不到已綁定的教練。可能已經 detach 過了，執行 status 確認。");
    process.exit(1);
  }

  await writeFile(
    STASH,
    JSON.stringify({ coachId: coach.id, lineUserId: coach.lineUserId }, null, 2),
  );

  await prisma.coach.update({
    where: { id: coach.id },
    data: { lineUserId: `detached:${coach.id}` },
  });

  // 換回未註冊選單，否則手機上還是顯示教練版六格。
  try {
    await bindRichMenu(coach.lineUserId, "none");
  } catch (err) {
    console.warn("Rich Menu 切換失敗（不影響資料）：", (err as Error).message);
  }

  console.log(`\n✓ 已解除「${coach.name}」的 LINE 綁定，原始值存於 ${STASH}`);
  console.log("  現在可以用同一個 LINE 帳號開學員邀請連結測試註冊流程。");
  console.log("  測完執行：npx tsx --env-file=.env scripts/dev-role.ts restore\n");
}

async function restore() {
  const stash = await readFile(STASH, "utf8").catch(() => null);
  if (!stash) {
    console.error(`找不到 ${STASH}，無法還原。`);
    process.exit(1);
  }
  const { coachId, lineUserId } = JSON.parse(stash) as {
    coachId: string;
    lineUserId: string;
  };

  await prisma.coach.update({ where: { id: coachId }, data: { lineUserId } });

  // coaches 與 members 的 line_user_id 唯一性各自獨立，同一個 LINE 帳號
  // 可以同時存在於兩張表。測試期間建立的學員記錄刻意保留，
  // 這樣教練端「我的學員」會正確顯示為已連結，可以驗證整條路徑。
  // 角色判定以教練優先（見 /api/liff/session），不會互相干擾。
  const asMember = await prisma.member.findUnique({
    where: { lineUserId },
    select: { displayName: true },
  });
  if (asMember) {
    console.log(`  註：學員記錄「${asMember.displayName}」保留為已連結狀態`);
  }

  try {
    await bindRichMenu(lineUserId, "coach");
  } catch (err) {
    console.warn("Rich Menu 切換失敗：", (err as Error).message);
  }

  await unlink(STASH);
  console.log("\n✓ 已還原教練身分與教練版選單\n");
}

const cmd = process.argv[2];
const actions: Record<string, () => Promise<void>> = { status, detach, restore };

(actions[cmd] ?? (async () => {
  console.error("用法: dev-role.ts status|detach|restore");
  process.exit(1);
}))()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
