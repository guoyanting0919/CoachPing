import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "./prisma";
import { fmt, fmtTimeRange, weekdayZh } from "./time";

/**
 * 推播佇列（SPEC.md §5）。
 *
 * 所有推播一律寫入 notifications 表，由 cron 取出後送發，不在 request 內直接 push。
 * 這樣重試、稽核、防重複才有地方做，也避免推播失敗連帶讓排課 API 失敗。
 */

/** Prisma 的 client 或 transaction client 都能用。 */
type Db = PrismaClient | Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/**
 * 為一批新建立的課程排入課前提醒。
 *
 * 只為已連結 LINE 的學員排——未連結的沒有 userId 可推，改走教練手動通知的
 * 降級流程（SPEC.md §8）。
 */
export async function enqueueSessionReminders(
  db: Db,
  sessionIds: string[],
): Promise<number> {
  if (sessionIds.length === 0) return 0;

  const sessions = await db.session.findMany({
    where: { id: { in: sessionIds }, status: "scheduled" },
    select: {
      id: true,
      startAt: true,
      coach: { select: { reminderHours: true } },
      participants: {
        select: { member: { select: { id: true, lineUserId: true } } },
      },
    },
  });

  const now = new Date();
  const rows: {
    targetLineUserId: string;
    type: "member_reminder";
    payload: { memberId: string };
    sendAt: Date;
    sessionId: string;
  }[] = [];

  for (const s of sessions) {
    // 已經開始的課不再提醒，提醒也沒有意義了。
    if (s.startAt <= now) continue;

    const sendAt = new Date(
      s.startAt.getTime() - s.coach.reminderHours * 60 * 60 * 1000,
    );

    for (const p of s.participants) {
      if (!p.member.lineUserId) continue;
      rows.push({
        targetLineUserId: p.member.lineUserId,
        type: "member_reminder",
        payload: { memberId: p.member.id },
        // 提醒時間已過（例如當天才排隔天以內的課）就盡快送出，
        // 而不是默默略過——學員仍然需要知道。
        sendAt: sendAt < now ? now : sendAt,
        sessionId: s.id,
      });
    }
  }

  if (rows.length === 0) return 0;

  await db.notification.createMany({ data: rows });
  return rows.length;
}

/** 課程改期：連同尚未送出的提醒一起移動。 */
export async function rescheduleReminders(db: Db, sessionId: string): Promise<void> {
  const session = await db.session.findUnique({
    where: { id: sessionId },
    select: { startAt: true, coach: { select: { reminderHours: true } } },
  });
  if (!session) return;

  const now = new Date();
  const sendAt = new Date(
    session.startAt.getTime() - session.coach.reminderHours * 60 * 60 * 1000,
  );

  await db.notification.updateMany({
    where: { sessionId, type: "member_reminder", status: "pending" },
    data: { sendAt: sendAt < now ? now : sendAt },
  });
}

/**
 * 課程取消：作廢尚未送出的提醒。
 * 已送出的保留，那是稽核紀錄；未送出的沒有意義，直接刪除。
 */
export async function cancelPendingNotifications(
  db: Db,
  sessionIds: string[],
): Promise<void> {
  if (sessionIds.length === 0) return;
  await db.notification.deleteMany({
    where: { sessionId: { in: sessionIds }, status: "pending" },
  });
}

/** 學員收到的課前提醒文字。 */
export async function renderMemberReminder(sessionId: string): Promise<string | null> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      startAt: true,
      durationMin: true,
      location: true,
      status: true,
      coach: { select: { name: true } },
    },
  });

  // 課已取消或消失就不該再送。取消時雖已作廢佇列，但可能有已取走的項目。
  if (!session || session.status !== "scheduled") return null;

  const lines = [
    "【上課提醒】",
    "",
    `${fmt(session.startAt, "M/d")}（${weekdayZh(session.startAt)}）${fmtTimeRange(session.startAt, session.durationMin)}`,
    `教練：${session.coach.name}`,
  ];

  if (session.location) lines.push(`地點：${session.location}`);

  lines.push("", "無法出席請點下方選單請假。");

  return lines.join("\n");
}
