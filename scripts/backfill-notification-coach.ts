/**
 * 回填 notifications.coach_id（SPEC.md §16）。
 *
 * 加欄位之前寫入的推播沒有歸屬。兩種類型的反推路徑不同：
 *   member_reminder / member_change → session_id → sessions.coach_id
 *   coach_leave / coach_daily       → target_line_user_id 就是教練本人
 *
 * 反推不到的（session_id 已被 SetNull）留 null，後台歸為「未歸屬」。
 * 不猜、不硬塞給任何教練——計費數字寧可少算也不能記到別人頭上。
 *
 *   npx tsx --env-file=.env scripts/backfill-notification-coach.ts [--dry]
 */
import { prisma } from "../src/lib/prisma";

async function main() {
  const dry = process.argv.includes("--dry");

  const before = await prisma.notification.count({ where: { coachId: null } });
  console.log(`\n未歸屬的推播：${before} 則`);

  if (before === 0) {
    console.log("沒有需要回填的資料。\n");
    return;
  }

  if (dry) {
    const [viaSession, viaTarget] = await Promise.all([
      prisma.notification.count({
        where: { coachId: null, session: { isNot: null } },
      }),
      prisma.notification.count({
        where: {
          coachId: null,
          session: null,
          type: { in: ["coach_leave", "coach_daily"] },
        },
      }),
    ]);
    console.log(`  可經 session 反推：${viaSession} 則`);
    console.log(`  可經 targetLineUserId 反推：約 ${viaTarget} 則`);
    console.log("\n（--dry：沒有寫入任何資料）\n");
    return;
  }

  // 走原生 SQL：逐筆 update 上千則會很慢，而且這兩句就是完整的反推邏輯。
  const bySession = await prisma.$executeRaw`
    UPDATE notifications n
    SET coach_id = s.coach_id
    FROM sessions s
    WHERE n.session_id = s.id AND n.coach_id IS NULL
  `;
  console.log(`  經 session 回填：${bySession} 則`);

  const byTarget = await prisma.$executeRaw`
    UPDATE notifications n
    SET coach_id = c.id
    FROM coaches c
    WHERE n.target_line_user_id = c.line_user_id AND n.coach_id IS NULL
  `;
  console.log(`  經 targetLineUserId 回填：${byTarget} 則`);

  const after = await prisma.notification.count({ where: { coachId: null } });
  console.log(`\n仍未歸屬：${after} 則（session 已斷、無法反推，後台會單獨顯示）\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
