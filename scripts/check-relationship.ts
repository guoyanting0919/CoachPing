/**
 * 結束合作相關查詢的手動驗證（唯讀）。npx tsx scripts/check-relationship.ts
 *
 * 驗兩件事：ended_at 真的在資料庫裡，以及學員清單那支帶關聯過濾的 groupBy
 * （確認畫面要講的「未來 N 堂課」）Prisma 接得住。
 */
// 這支不是跑在 Next.js 裡，env 要自己載（prisma7.config.ts 同理）。
import "dotenv/config";
import { prisma } from "../src/lib/prisma";

async function main() {
  const links = await prisma.coachMember.findMany({
    select: { status: true, endedAt: true, displayName: true },
    take: 10,
  });
  console.log(`coach_members：${links.length} 筆，ended_at 可讀`);
  for (const l of links) {
    console.log(`  ${l.displayName} → ${l.status} / ended_at=${l.endedAt?.toISOString() ?? "null"}`);
  }

  const coach = await prisma.coach.findFirst({ select: { id: true, name: true } });
  if (!coach) {
    console.log("沒有教練資料，跳過 groupBy");
    return;
  }

  const counts = await prisma.sessionParticipant.groupBy({
    by: ["memberId"],
    where: {
      session: { coachId: coach.id, status: "scheduled", startAt: { gte: new Date() } },
    },
    _count: { sessionId: true },
  });
  console.log(`groupBy（${coach.name}）未來課數：`, JSON.stringify(counts));
}

main()
  .catch((e) => {
    console.error("FAILED:", e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
