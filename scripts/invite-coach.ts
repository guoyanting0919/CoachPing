/**
 * 產生教練邀請連結。MVP 階段教練不自助註冊，由開發者手動發碼（SPEC.md §3.1）。
 *
 *   npx tsx scripts/invite-coach.ts "王教練" [有效天數，預設 14]
 */
import { prisma } from "../src/lib/prisma";

async function main() {
  const label = process.argv[2];
  const days = Number(process.argv[3] ?? 14);

  if (!label) {
    console.error('用法: npx tsx scripts/invite-coach.ts "王教練" [有效天數]');
    process.exit(1);
  }

  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  if (!liffId) {
    console.error("缺少 NEXT_PUBLIC_LIFF_ID");
    process.exit(1);
  }

  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const invite = await prisma.coachInvite.create({ data: { label, expiresAt } });

  console.log(`\n給「${label}」的教練邀請連結（${days} 天內有效，只能用一次）：\n`);
  console.log(`  https://liff.line.me/${liffId}?t=${invite.token}\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
