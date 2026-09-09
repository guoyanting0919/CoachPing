import { prisma } from "./prisma";
import { fmt, fmtTimeRange, taipeiDateTime, weekdayZh, ymd } from "./time";

/**
 * 產生教練的今日課表文字。
 * 走 reply message（免費），不佔用推播額度（SPEC.md §5）。
 */
export async function buildCoachTodayText(coachId: string): Promise<string> {
  const today = ymd(new Date());
  const start = taipeiDateTime(today, "00:00");
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  const sessions = await prisma.session.findMany({
    where: {
      coachId,
      status: "scheduled",
      startAt: { gte: start, lt: end },
    },
    orderBy: { startAt: "asc" },
    select: {
      startAt: true,
      durationMin: true,
      participants: { select: { memberId: true } },
    },
  });

  const header = `${fmt(start, "M/d")}（${weekdayZh(start)}）今日課表`;

  if (sessions.length === 0) {
    return `${header}\n\n今天沒有課。`;
  }

  // 教練端顯示的名字一律取自關係，不讀 members.display_name（SPEC.md §4）。
  const links = await prisma.coachMember.findMany({
    where: { coachId },
    select: { memberId: true, displayName: true },
  });
  const nameOf = new Map(links.map((l) => [l.memberId, l.displayName]));

  const lines = sessions.map((s) => {
    const names = s.participants
      .map((p) => nameOf.get(p.memberId) ?? "（已移除）")
      .join("、");
    return `${fmtTimeRange(s.startAt, s.durationMin)}　${names}`;
  });

  return `${header}\n\n${lines.join("\n")}\n\n共 ${sessions.length} 堂`;
}

/** 學員課表的顯示範圍（天）。 */
const MEMBER_RANGE_DAYS = 30;

/**
 * 學員的課表文字，涵蓋未來 30 天。
 * 跨教練合併——學員可能同時上多位教練的課，而他只有一個 LINE 帳號。
 */
export async function buildMemberScheduleText(memberId: string): Promise<string> {
  const now = new Date();
  const until = new Date(now.getTime() + MEMBER_RANGE_DAYS * 24 * 60 * 60 * 1000);

  const sessions = await prisma.session.findMany({
    where: {
      status: "scheduled",
      startAt: { gte: now, lt: until },
      participants: { some: { memberId } },
    },
    orderBy: { startAt: "asc" },
    select: {
      startAt: true,
      durationMin: true,
      coach: { select: { name: true } },
    },
  });

  const header = `你的課表（未來 ${MEMBER_RANGE_DAYS} 天）`;

  if (sessions.length === 0) {
    return `${header}\n\n目前沒有排定的課程。教練排課後會提前通知你。`;
  }

  const lines = sessions.map(
    (s) =>
      `${fmt(s.startAt, "M/d")}（${weekdayZh(s.startAt)}）${fmtTimeRange(s.startAt, s.durationMin)}　${s.coach.name} 教練`,
  );

  return [
    header,
    "",
    ...lines,
    "",
    `共 ${sessions.length} 堂`,
    "需要請假請點下方選單的「請假」。",
  ].join("\n");
}
