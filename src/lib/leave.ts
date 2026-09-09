import type { PrismaClient } from "@/generated/prisma/client";
import { cancelPendingNotifications } from "./notifications";

/**
 * 請假流程（SPEC.md §6）。
 *
 * 請假取消的是「該學員在該堂課的參與」，不是整堂課——一堂課最多 3 人，
 * 小明請假時小華那堂課還是要上。只有當一堂課沒有人剩下時才整堂取消。
 */

type Db = PrismaClient | Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export type LeaveOutcome = {
  status: "auto_approved" | "pending";
  /** 是否因為沒有其他學員而整堂取消。 */
  sessionCancelled: boolean;
};

/** 距上課還有幾小時。負值代表已經開始。 */
export function hoursUntil(startAt: Date, now: Date = new Date()): number {
  return (startAt.getTime() - now.getTime()) / (60 * 60 * 1000);
}

/**
 * 核准請假：把學員從該堂課移除，並清掉他自己那則尚未送出的提醒。
 * 若這堂課因此沒有人了，整堂標記取消。
 */
export async function applyApprovedLeave(
  db: Db,
  sessionId: string,
  memberId: string,
): Promise<{ sessionCancelled: boolean }> {
  await db.sessionParticipant.deleteMany({ where: { sessionId, memberId } });

  const member = await db.member.findUnique({
    where: { id: memberId },
    select: { lineUserId: true },
  });

  // 只清這位學員的提醒，其他參與者的照舊。
  if (member?.lineUserId) {
    await db.notification.deleteMany({
      where: {
        sessionId,
        status: "pending",
        type: "member_reminder",
        targetLineUserId: member.lineUserId,
      },
    });
  }

  const remaining = await db.sessionParticipant.count({ where: { sessionId } });
  if (remaining > 0) return { sessionCancelled: false };

  await db.session.update({ where: { id: sessionId }, data: { status: "cancelled" } });
  await cancelPendingNotifications(db, [sessionId]);

  return { sessionCancelled: true };
}
