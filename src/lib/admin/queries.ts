import type { NotificationType } from "@/generated/prisma/enums";
import { inviteUrl } from "../auth";
import { prisma } from "../prisma";
import { ymd } from "../time";
import {
  BUCKETS,
  ZERO_COUNTS,
  bucketRanges,
  taipeiMidnight,
  type BucketCounts,
  type BucketRange,
} from "./time-buckets";
import { requireAdmin } from "./session";

/**
 * 管理後台的資料存取層（SPEC.md §16）。
 *
 * 每個函式第一行都 await requireAdmin()——這裡是真正的授權邊界，
 * 不是 proxy.ts，也不是 layout.tsx。RSC 直接呼叫這些函式，不經過 /api。
 *
 * 一律明確 select 欄位：傳進 Client Component 的 props 會整包序列化進
 * RSC payload，`include` 一個 coach 就會把 icalToken 一起送到瀏覽器。
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** 「計費推播」＝ 真的送到 LINE 的那些。skipped 沒送出、failed 沒送成，都不計費。 */
const BILLED = { status: "sent" } as const;

function sentAtFilter(range: BucketRange) {
  if (!range.gte && !range.lt) return undefined;
  return { gte: range.gte, lt: range.lt };
}

/** 一次算完四個時間桶。回傳 key 為 coachId，null 代表回填不到的舊資料。 */
async function billedByCoach(now: Date): Promise<Map<string | null, BucketCounts>> {
  const ranges = bucketRanges(now);

  const grouped = await Promise.all(
    BUCKETS.map(async (bucket) => {
      const rows = await prisma.notification.groupBy({
        by: ["coachId"],
        where: { ...BILLED, sentAt: sentAtFilter(ranges[bucket]) },
        _count: { _all: true },
      });
      return { bucket, rows };
    }),
  );

  const out = new Map<string | null, BucketCounts>();
  for (const { bucket, rows } of grouped) {
    for (const row of rows) {
      const current = out.get(row.coachId) ?? { ...ZERO_COUNTS };
      current[bucket] = row._count._all;
      out.set(row.coachId, current);
    }
  }
  return out;
}

async function billedTotals(now: Date): Promise<BucketCounts> {
  const ranges = bucketRanges(now);
  const counts = await Promise.all(
    BUCKETS.map((bucket) =>
      prisma.notification.count({
        where: { ...BILLED, sentAt: sentAtFilter(ranges[bucket]) },
      }),
    ),
  );

  return BUCKETS.reduce(
    (acc, bucket, i) => ({ ...acc, [bucket]: counts[i] }),
    { ...ZERO_COUNTS },
  ) as BucketCounts;
}

export type DailyPush = { day: string; count: number };

/**
 * 過去 14 天每日計費推播數，含沒有推播的日子（補 0，否則長條圖會壓縮時間軸）。
 * 用 SQL 在台北時區切日，不撈全部回來自己分組。
 */
async function dailyBilled(now: Date, days = 14): Promise<DailyPush[]> {
  const from = taipeiMidnight(days - 1, now);

  const rows = await prisma.$queryRaw<{ day: string; count: number }[]>`
    SELECT to_char(sent_at AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD') AS day,
           count(*)::int AS count
    FROM notifications
    WHERE status = 'sent'::"NotificationStatus" AND sent_at >= ${from}
    GROUP BY 1
    ORDER BY 1
  `;

  const byDay = new Map(rows.map((r) => [r.day, r.count]));
  const out: DailyPush[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = ymd(new Date(now.getTime() - i * DAY_MS));
    out.push({ day: key, count: byDay.get(key) ?? 0 });
  }
  return out;
}

export type Dashboard = {
  coaches: { total: number; activeLast7d: number };
  members: { total: number; linked: number };
  upcomingSessions7d: number;
  billed: BucketCounts;
  unattributedTotal: number;
  failedLast7d: number;
  byType: { type: NotificationType; count: number }[];
  daily: DailyPush[];
};

export async function getDashboard(): Promise<Dashboard> {
  await requireAdmin();

  const now = new Date();
  const weekAgo = taipeiMidnight(7, now);

  const [
    coachTotal,
    activeCoachRows,
    memberTotal,
    memberLinked,
    upcomingSessions7d,
    billed,
    unattributedTotal,
    failedLast7d,
    typeRows,
    daily,
  ] = await Promise.all([
    prisma.coach.count(),
    // 「還在用」的定義：過去 7 天內排過課。比註冊時間有用得多。
    prisma.session.groupBy({ by: ["coachId"], where: { createdAt: { gte: weekAgo } } }),
    prisma.member.count(),
    prisma.member.count({ where: { lineUserId: { not: null } } }),
    prisma.session.count({
      where: {
        status: "scheduled",
        startAt: { gte: now, lt: new Date(now.getTime() + 7 * DAY_MS) },
      },
    }),
    billedTotals(now),
    prisma.notification.count({ where: { ...BILLED, coachId: null } }),
    // failed 的列沒有 sentAt（沒送出去），claimedAt 也在失敗時被清空，
    // 所以只能用 sendAt 當時間軸——重試都在幾分鐘內結束，誤差可接受。
    prisma.notification.count({ where: { status: "failed", sendAt: { gte: weekAgo } } }),
    prisma.notification.groupBy({
      by: ["type"],
      where: BILLED,
      _count: { _all: true },
    }),
    dailyBilled(now),
  ]);

  return {
    coaches: { total: coachTotal, activeLast7d: activeCoachRows.length },
    members: { total: memberTotal, linked: memberLinked },
    upcomingSessions7d,
    billed,
    unattributedTotal,
    failedLast7d,
    byType: typeRows.map((r) => ({ type: r.type, count: r._count._all })),
    daily,
  };
}

export type CoachRow = {
  id: string;
  name: string;
  createdAt: Date;
  memberCount: number;
  upcoming7d: number;
  lastScheduledAt: Date | null;
  billed: BucketCounts;
};

export async function listCoaches(): Promise<CoachRow[]> {
  await requireAdmin();

  const now = new Date();

  const [coaches, upcomingRows, lastRows, billed] = await Promise.all([
    prisma.coach.findMany({
      select: {
        id: true,
        name: true,
        createdAt: true,
        _count: { select: { members: true } },
      },
    }),
    prisma.session.groupBy({
      by: ["coachId"],
      where: {
        status: "scheduled",
        startAt: { gte: now, lt: new Date(now.getTime() + 7 * DAY_MS) },
      },
      _count: { _all: true },
    }),
    // 「最後一次排課」是排課這個動作的時間，不是課本身的時間。
    prisma.session.groupBy({ by: ["coachId"], _max: { createdAt: true } }),
    billedByCoach(now),
  ]);

  const upcoming = new Map(upcomingRows.map((r) => [r.coachId, r._count._all]));
  const last = new Map(lastRows.map((r) => [r.coachId, r._max.createdAt]));

  return coaches
    .map((c) => ({
      id: c.id,
      name: c.name,
      createdAt: c.createdAt,
      memberCount: c._count.members,
      upcoming7d: upcoming.get(c.id) ?? 0,
      lastScheduledAt: last.get(c.id) ?? null,
      billed: billed.get(c.id) ?? { ...ZERO_COUNTS },
    }))
    .sort((a, b) => {
      // 從沒排過課的沉到最底——那正是你想看到的異常。
      const at = a.lastScheduledAt?.getTime() ?? -1;
      const bt = b.lastScheduledAt?.getTime() ?? -1;
      return bt - at;
    });
}

export type PendingInvite = {
  token: string;
  /** 完整的 LIFF 連結。教練要的是這個，不是裸 token。 */
  url: string;
  label: string;
  expiresAt: Date;
  createdAt: Date;
  expired: boolean;
};

export type UsedInvite = {
  token: string;
  label: string;
  usedAt: Date;
  coachId: string | null;
  coachName: string | null;
};

export async function listCoachInvites(): Promise<{
  pending: PendingInvite[];
  used: UsedInvite[];
}> {
  await requireAdmin();

  const now = new Date();
  const invites = await prisma.coachInvite.findMany({
    select: {
      token: true,
      label: true,
      expiresAt: true,
      usedAt: true,
      coachId: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const coachIds = invites.map((i) => i.coachId).filter((id): id is string => !!id);
  const coaches = coachIds.length
    ? await prisma.coach.findMany({
        where: { id: { in: coachIds } },
        select: { id: true, name: true },
      })
    : [];
  const nameById = new Map(coaches.map((c) => [c.id, c.name]));

  return {
    pending: invites
      .filter((i) => !i.usedAt)
      .map((i) => ({
        token: i.token,
        url: inviteUrl(i.token),
        label: i.label,
        expiresAt: i.expiresAt,
        createdAt: i.createdAt,
        expired: i.expiresAt < now,
      })),
    used: invites
      .filter((i) => i.usedAt)
      .map((i) => ({
        token: i.token,
        label: i.label,
        usedAt: i.usedAt!,
        coachId: i.coachId,
        coachName: i.coachId ? (nameById.get(i.coachId) ?? null) : null,
      })),
  };
}

export type CoachDetail = {
  coach: {
    id: string;
    name: string;
    lineUserId: string;
    oaUrl: string;
    leaveDeadlineHours: number;
    reminderHours: number;
    defaultDuration: number;
    icalToken: string;
    createdAt: Date;
  };
  billed: BucketCounts;
  members: {
    memberId: string;
    displayName: string;
    selfName: string;
    status: string;
    lineUserId: string | null;
    lineBlocked: boolean;
    sessionCount: number;
    createdAt: Date;
  }[];
  sessions: {
    id: string;
    startAt: Date;
    durationMin: number;
    location: string | null;
    status: string;
    seriesId: string | null;
    participants: string[];
  }[];
  sessionsTruncated: boolean;
  leaves: {
    id: string;
    createdAt: Date;
    status: string;
    reason: string | null;
    memberName: string;
    startAt: Date;
  }[];
};

/** 課程只取「過去 30 天 + 未來全部」，硬上限 200 筆。翻更久遠的歷史請用 Prisma Studio。 */
const SESSION_WINDOW_DAYS = 30;
const SESSION_LIMIT = 200;

export async function getCoachDetail(coachId: string): Promise<CoachDetail | null> {
  await requireAdmin();

  const now = new Date();

  const coach = await prisma.coach.findUnique({
    where: { id: coachId },
    select: {
      id: true,
      name: true,
      lineUserId: true,
      oaUrl: true,
      leaveDeadlineHours: true,
      reminderHours: true,
      defaultDuration: true,
      icalToken: true,
      createdAt: true,
    },
  });
  if (!coach) return null;

  const [links, sessionCounts, sessionRows, leaveRows, billed] = await Promise.all([
    prisma.coachMember.findMany({
      where: { coachId },
      select: {
        memberId: true,
        displayName: true,
        status: true,
        createdAt: true,
        member: {
          select: { displayName: true, lineUserId: true, lineBlocked: true },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.sessionParticipant.groupBy({
      by: ["memberId"],
      where: { session: { coachId } },
      _count: { _all: true },
    }),
    prisma.session.findMany({
      where: {
        coachId,
        startAt: { gte: new Date(now.getTime() - SESSION_WINDOW_DAYS * DAY_MS) },
      },
      select: {
        id: true,
        startAt: true,
        durationMin: true,
        location: true,
        status: true,
        seriesId: true,
        participants: { select: { memberId: true } },
      },
      orderBy: { startAt: "asc" },
      take: SESSION_LIMIT + 1,
    }),
    prisma.leaveRequest.findMany({
      where: { session: { coachId } },
      select: {
        id: true,
        createdAt: true,
        status: true,
        reason: true,
        memberId: true,
        session: { select: { startAt: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    billedByCoach(now),
  ]);

  const countByMember = new Map(sessionCounts.map((r) => [r.memberId, r._count._all]));
  // 教練端一律顯示 coach_members.display_name（SPEC.md §4），後台跟著同一份稱呼，
  // 這樣你看到的名字跟教練看到的一致，回報問題時不會雞同鴨講。
  const nameByMember = new Map(links.map((l) => [l.memberId, l.displayName]));

  return {
    coach,
    billed: billed.get(coachId) ?? { ...ZERO_COUNTS },
    members: links.map((l) => ({
      memberId: l.memberId,
      displayName: l.displayName,
      selfName: l.member.displayName,
      status: l.status,
      lineUserId: l.member.lineUserId,
      lineBlocked: l.member.lineBlocked,
      sessionCount: countByMember.get(l.memberId) ?? 0,
      createdAt: l.createdAt,
    })),
    sessions: sessionRows.slice(0, SESSION_LIMIT).map((s) => ({
      id: s.id,
      startAt: s.startAt,
      durationMin: s.durationMin,
      location: s.location,
      status: s.status,
      seriesId: s.seriesId,
      participants: s.participants.map(
        (p) => nameByMember.get(p.memberId) ?? "（已移除的學員）",
      ),
    })),
    sessionsTruncated: sessionRows.length > SESSION_LIMIT,
    leaves: leaveRows.map((l) => ({
      id: l.id,
      createdAt: l.createdAt,
      status: l.status,
      reason: l.reason,
      memberName: nameByMember.get(l.memberId) ?? "（已移除的學員）",
      startAt: l.session.startAt,
    })),
  };
}
