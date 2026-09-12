import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "./prisma";
import { fmt, fmtTimeRange, taipeiDateTime, weekdayZh, ymd } from "./time";

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
      coach: { select: { id: true, reminderHours: true } },
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
    coachId: string;
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
        coachId: s.coach.id,
      });
    }
  }

  if (rows.length === 0) return 0;

  await db.notification.createMany({ data: rows });
  return rows.length;
}

/**
 * 排課完成通知（SPEC.md §5）。
 *
 * 教練排完課後，給每位「已連結 LINE」的學員一則彙總：上半部是這次排定的課，
 * 下半部是接下來一整段時間的完整課表。一次排課動作每位學員只發一則，
 * 重複課程展開成 12 堂也還是一則。
 *
 * 範圍終點在排課當下算好存進 payload——它反映「這次排了什麼」，是歷史事實，
 * 送出時重算沒有意義。起點則永遠是送出當下，才不會列出已經上完的課。
 */
export async function enqueueScheduleNotice(
  db: Db,
  coachId: string,
  sessionIds: string[],
  memberIds: string[],
  lastStartAt: Date,
): Promise<number> {
  if (sessionIds.length === 0 || memberIds.length === 0) return 0;

  const members = await db.member.findMany({
    where: { id: { in: memberIds }, lineUserId: { not: null } },
    select: { id: true, lineUserId: true },
  });
  if (members.length === 0) return 0;

  const rangeEndAt = scheduleRangeEnd(lastStartAt);

  await db.notification.createMany({
    data: members.map((m) => ({
      targetLineUserId: m.lineUserId!,
      type: "member_schedule" as const,
      payload: {
        memberId: m.id,
        sessionIds,
        rangeEndAt: rangeEndAt.toISOString(),
      },
      sendAt: new Date(),
      coachId,
    })),
  });

  return members.length;
}

/**
 * 課表彙總的範圍終點：今天起一個月後的當日 23:59，或這次最後一堂課，取較晚者。
 *
 * 取較晚者是為了避免自相矛盾——教練最多可一次排 12 週（約 3 個月），
 * 若硬性只列一個月，這則「排課完成通知」會看不到自己剛排的課。
 *
 * 日曆運算走 UTC 整數天再轉台北時刻，與 schedule.ts 一致，
 * 避免伺服器時區（Vercel 上是 UTC）影響日期判斷。
 */
function scheduleRangeEnd(lastStartAt: Date, now = new Date()): Date {
  const [y, m, d] = ymd(now).split("-").map(Number);

  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  // 下個月沒有這一天時退到該月最後一天（1/31 → 2/28）。
  const lastDayOfNextMonth = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const nd = Math.min(d, lastDayOfNextMonth);

  const pad = (n: number) => String(n).padStart(2, "0");
  const oneMonthOut = taipeiDateTime(`${ny}-${pad(nm)}-${pad(nd)}`, "23:59");

  return lastStartAt > oneMonthOut ? lastStartAt : oneMonthOut;
}

/** 下半部的顯示上限。超過就請學員自己去看課表，不把訊息塞爆。 */
const SCHEDULE_LIST_LIMIT = 30;

/** 「9/17 (三) 19:00–20:00 @ 大安店」。地點接在同一行，另起一行會讓清單散掉。 */
function scheduleLine(s: { startAt: Date; durationMin: number; location: string | null }) {
  const base = `${fmt(s.startAt, "M/d")} (${weekdayZh(s.startAt)}) ${fmtTimeRange(s.startAt, s.durationMin)}`;
  return s.location ? `${base} @ ${s.location}` : base;
}

/** 學員收到的排課完成通知。 */
export async function renderMemberSchedule(
  coachId: string | null,
  payload: { memberId?: string; sessionIds?: string[]; rangeEndAt?: string } | null,
): Promise<string | null> {
  if (!coachId || !payload?.memberId || !payload.sessionIds?.length) return null;

  const coach = await prisma.coach.findUnique({
    where: { id: coachId },
    select: { name: true },
  });
  if (!coach) return null;

  const select = {
    startAt: true,
    durationMin: true,
    location: true,
  } as const;

  // 上半部：這次排定的課。限定 scheduled，所以排完立刻被取消的那幾堂會自動消失。
  const created = await prisma.session.findMany({
    where: { id: { in: payload.sessionIds }, status: "scheduled" },
    orderBy: { startAt: "asc" },
    select,
  });

  // 這次排的課全被取消了，這則通知就失去意義。取消本身已有 member_change 通知過。
  if (created.length === 0) return null;

  const rangeEnd = payload.rangeEndAt ? new Date(payload.rangeEndAt) : null;

  // 下半部：範圍內這位教練的全部課程，含上半部那幾堂（重複顯示是刻意的——
  // 下半部要能獨立當成一份完整課表閱讀，缺一角就得靠學員自己在腦中合併）。
  const upcomingWhere = {
    coachId,
    status: "scheduled" as const,
    startAt: rangeEnd ? { gte: new Date(), lte: rangeEnd } : { gte: new Date() },
    participants: { some: { memberId: payload.memberId } },
  };

  const shown = await prisma.session.findMany({
    where: upcomingWhere,
    orderBy: { startAt: "asc" },
    take: SCHEDULE_LIST_LIMIT,
    select,
  });

  // 撈滿上限才去數總數。用 take: LIMIT + 1 推算是錯的——那只知道「超過 30」，
  // 實際有 40 堂時會顯示「還有 1 堂」。多一次 count 只發生在真的超量時。
  const overflow =
    shown.length === SCHEDULE_LIST_LIMIT
      ? (await prisma.session.count({ where: upcomingWhere })) - SCHEDULE_LIST_LIMIT
      : 0;

  const lines = [
    "【課程已排定】",
    "",
    `${coach.name}為你排定了 ${created.length} 堂課`,
    ...created.map(scheduleLine),
  ];

  if (shown.length > 0) {
    lines.push("", "你接下來的課表", ...shown.map(scheduleLine));
    if (overflow > 0) {
      lines.push(`還有 ${overflow} 堂，請點下方選單的「我的課表」查看`);
    }
  }

  lines.push("", "無法出席請點下方選單請假。");

  return lines.join("\n");
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
 * 課程取消：作廢尚未送出的「課前提醒」。
 * 已送出的保留，那是稽核紀錄；未送出的沒有意義，直接刪除。
 *
 * 僅限 member_reminder：取消課程的同時會排入 member_change 異動通知，
 * 不限定型別的話會把那則剛建立的通知一起刪掉，學員就永遠不知道課取消了。
 */
export async function cancelPendingNotifications(
  db: Db,
  sessionIds: string[],
): Promise<void> {
  if (sessionIds.length === 0) return;
  await db.notification.deleteMany({
    where: {
      sessionId: { in: sessionIds },
      status: "pending",
      type: "member_reminder",
    },
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

/**
 * 教練收到的請假通知。
 * 自動核准的只是告知；未達門檻的需要教練決定，文案要說清楚。
 */
export async function renderCoachLeave(leaveRequestId: string): Promise<string | null> {
  const leave = await prisma.leaveRequest.findUnique({
    where: { id: leaveRequestId },
    select: {
      status: true,
      reason: true,
      memberId: true,
      session: {
        select: {
          coachId: true,
          startAt: true,
          durationMin: true,
          participants: { select: { memberId: true } },
        },
      },
    },
  });
  if (!leave) return null;

  const link = await prisma.coachMember.findUnique({
    where: {
      coachId_memberId: { coachId: leave.session.coachId, memberId: leave.memberId },
    },
    select: { displayName: true },
  });
  const name = link?.displayName ?? "某位學員";

  const when = `${fmt(leave.session.startAt, "M/d")}（${weekdayZh(leave.session.startAt)}）${fmtTimeRange(leave.session.startAt, leave.session.durationMin)}`;

  if (leave.status === "auto_approved") {
    const others = leave.session.participants.length;
    return [
      "【學員請假】",
      "",
      `${name} 已請假`,
      when,
      leave.reason ? `原因：${leave.reason}` : null,
      "",
      others > 0 ? `這堂課還有 ${others} 位學員。` : "這堂課已無人參加，已自動取消。",
    ]
      .filter((l) => l !== null)
      .join("\n");
  }

  return [
    "【請假待確認】",
    "",
    `${name} 申請請假`,
    when,
    leave.reason ? `原因：${leave.reason}` : null,
    "",
    "已超過你設定的請假期限，請到下方選單的「請假通知」決定是否同意。",
  ]
    .filter((l) => l !== null)
    .join("\n");
}

/** 排入教練的請假通知。即時送出。 */
export async function enqueueCoachLeave(
  db: Db,
  leaveRequestId: string,
  sessionId: string,
  coachLineUserId: string,
  coachId: string,
): Promise<void> {
  await db.notification.createMany({
    data: [
      {
        targetLineUserId: coachLineUserId,
        type: "coach_leave",
        payload: { leaveRequestId },
        sendAt: new Date(),
        sessionId,
        coachId,
      },
    ],
  });
}

/**
 * 教練收到的預約通知（SPEC.md §5）。
 *
 * 學員一次可預約多堂（上限為 coaches.max_open_bookings），而那**只發一則**：
 * 一次預約動作是一件事，拆成三則推播是三倍成本換來同一個資訊。
 * 學員自己不收確認訊息——他剛按完按鈕、畫面上就有結果。
 */
export async function renderCoachBooking(
  sessionIds: string[],
): Promise<string | null> {
  if (sessionIds.length === 0) return null;

  // 限定 scheduled：預約後立刻請假掉的那幾堂會自動從清單消失。
  const sessions = await prisma.session.findMany({
    where: { id: { in: sessionIds }, status: "scheduled" },
    orderBy: { startAt: "asc" },
    select: {
      startAt: true,
      durationMin: true,
      coachId: true,
      participants: { select: { memberId: true } },
    },
  });

  // 全部都不在了，這則通知失去意義。取消本身已有別的通知路徑。
  if (sessions.length === 0) return null;

  // 預約產生的課只有一位參與者（SPEC.md §3.6：不能約進他人已有的課），
  // 且一次預約的每一堂都是同一位學員。
  const memberId = sessions[0].participants[0]?.memberId;
  if (!memberId) return null;

  // 教練端顯示的名字一律取自關係，不讀 members.display_name（SPEC.md §4）。
  const link = await prisma.coachMember.findUnique({
    where: { coachId_memberId: { coachId: sessions[0].coachId, memberId } },
    select: { displayName: true },
  });

  return [
    "【學員預約】",
    "",
    `${link?.displayName ?? "某位學員"} 預約了 ${sessions.length} 堂課`,
    ...sessions.map((s) => when(s.startAt, s.durationMin)),
    "",
    sessions.length === 1
      ? "這堂課已經排進你的課表。不方便的話請到下方選單的「我的課表」取消。"
      : "這些課已經排進你的課表。不方便的話請到下方選單的「我的課表」逐堂取消。",
  ].join("\n");
}

/**
 * 排入教練的預約通知，即時送出。一次預約動作一則，不論約了幾堂。
 *
 * sessionId 欄位只放第一堂：那個欄位是給「課程異動時找出相關通知」用的單一外鍵，
 * 真正的清單在 payload.sessionIds。少了 sessionId 會讓這則通知無從歸屬某堂課，
 * 但放上全部也做不到——欄位只有一個。
 */
export async function enqueueCoachBooking(
  db: Db,
  sessionIds: string[],
  coachLineUserId: string,
  coachId: string,
): Promise<void> {
  if (sessionIds.length === 0) return;

  await db.notification.createMany({
    data: [
      {
        targetLineUserId: coachLineUserId,
        type: "coach_booking",
        payload: { sessionIds },
        sendAt: new Date(),
        sessionId: sessionIds[0],
        coachId,
      },
    ],
  });
}

/** 學員收到的課程異動通知。 */
export async function renderMemberChange(
  payload: {
    kind?: string;
    leaveRequestId?: string;
    sessionId?: string;
    sessionIds?: string[];
    oldStartAt?: string;
  } | null,
): Promise<string | null> {
  if (!payload?.kind) return null;

  if (payload.kind === "leave_approved" || payload.kind === "leave_rejected") {
    if (!payload.leaveRequestId) return null;

    const leave = await prisma.leaveRequest.findUnique({
      where: { id: payload.leaveRequestId },
      select: {
        session: {
          select: {
            startAt: true,
            durationMin: true,
            coach: { select: { name: true } },
          },
        },
      },
    });
    if (!leave) return null;

    const when = `${fmt(leave.session.startAt, "M/d")}（${weekdayZh(leave.session.startAt)}）${fmtTimeRange(leave.session.startAt, leave.session.durationMin)}`;

    return payload.kind === "leave_approved"
      ? ["【請假已同意】", "", when, `${leave.session.coach.name} 教練已同意你的請假。`].join("\n")
      : [
          "【請假未通過】",
          "",
          when,
          `${leave.session.coach.name} 教練未同意這次請假，這堂課仍照原定時間進行。`,
          "",
          "有疑問請直接聯絡教練。",
        ].join("\n");
  }

  if (payload.kind === "cancelled_digest") {
    const ids = payload.sessionIds;
    if (!ids?.length) return null;

    const sessions = await prisma.session.findMany({
      where: { id: { in: ids } },
      orderBy: { startAt: "asc" },
      select: {
        startAt: true,
        durationMin: true,
        coach: { select: { name: true } },
      },
    });
    if (sessions.length === 0) return null;

    const coachName = sessions[0]!.coach.name;

    return [
      "【課程取消】",
      "",
      ...sessions.map((s) => when(s.startAt, s.durationMin)),
      "",
      sessions.length === 1
        ? `${coachName} 教練取消了這堂課。`
        : `${coachName} 教練取消了以上 ${sessions.length} 堂課。`,
      "",
      "有疑問請直接聯絡教練。",
    ].join("\n");
  }

  if (payload.kind === "cancelled" || payload.kind === "rescheduled") {
    if (!payload.sessionId) return null;

    const session = await prisma.session.findUnique({
      where: { id: payload.sessionId },
      select: {
        startAt: true,
        durationMin: true,
        coach: { select: { name: true } },
      },
    });
    if (!session) return null;

    if (payload.kind === "cancelled") {
      return [
        "【課程取消】",
        "",
        when(session.startAt, session.durationMin),
        `${session.coach.name} 教練取消了這堂課。`,
        "",
        "有疑問請直接聯絡教練。",
      ].join("\n");
    }

    // 改期一定要同時給舊時間，只說新時間學員不知道是哪一堂被動了。
    const oldAt = payload.oldStartAt ? new Date(payload.oldStartAt) : null;

    return [
      "【課程改期】",
      "",
      oldAt ? `原　${when(oldAt, session.durationMin)}` : null,
      `改為　${when(session.startAt, session.durationMin)}`,
      "",
      `${session.coach.name} 教練調整了上課時間。`,
    ]
      .filter((l) => l !== null)
      .join("\n");
  }

  return null;
}

function when(startAt: Date, durationMin: number): string {
  return `${fmt(startAt, "M/d")}（${weekdayZh(startAt)}）${fmtTimeRange(startAt, durationMin)}`;
}

/** 排入學員的異動通知，即時送出。 */
export type MemberChangePayload = {
  kind: "leave_approved" | "leave_rejected" | "cancelled" | "rescheduled";
  leaveRequestId?: string;
  sessionId?: string;
  /** 改期通知用。只說新時間的話，學員不知道是哪一堂被動了。 */
  oldStartAt?: string;
};

export async function enqueueMemberChange(
  db: Db,
  targetLineUserId: string,
  sessionId: string,
  coachId: string,
  payload: MemberChangePayload,
): Promise<void> {
  await db.notification.createMany({
    data: [
      {
        targetLineUserId,
        type: "member_change",
        payload,
        sendAt: new Date(),
        sessionId,
        coachId,
      },
    ],
  });
}

/**
 * 為一批課程的所有參與者排入異動通知，即時送出。
 * 未連結 LINE 的學員沒有 userId 可推，改走教練手動通知的降級流程。
 */
export async function enqueueSessionChange(
  db: Db,
  sessions: { id: string; oldStartAt?: Date }[],
  kind: "cancelled" | "rescheduled",
): Promise<number> {
  if (sessions.length === 0) return 0;

  const participants = await db.sessionParticipant.findMany({
    where: { sessionId: { in: sessions.map((s) => s.id) } },
    select: {
      sessionId: true,
      session: { select: { coachId: true } },
      member: { select: { lineUserId: true } },
    },
  });

  const oldById = new Map(sessions.map((s) => [s.id, s.oldStartAt]));
  const now = new Date();

  const rows = participants
    .filter((p) => p.member.lineUserId)
    .map((p) => ({
      targetLineUserId: p.member.lineUserId!,
      type: "member_change" as const,
      payload: {
        kind,
        sessionId: p.sessionId,
        oldStartAt: oldById.get(p.sessionId)?.toISOString(),
      },
      sendAt: now,
      sessionId: p.sessionId,
      coachId: p.session.coachId,
    }));

  if (rows.length === 0) return 0;

  await db.notification.createMany({ data: rows });
  return rows.length;
}

/**
 * 一次取消多堂課時，學員只收到一則彙總（結束合作會這樣，SPEC.md §4）。
 *
 * 不重用 enqueueSessionChange：它是逐堂逐人各一則，取消 8 堂課就是 8 則 LINE 訊息——
 * 既像騷擾，也照則數計進教練的推播用量（SPEC.md §16）。
 *
 * sessionId 欄位留 null：這則通知不屬於任何單一課程，掛上其中一堂會讓
 * cancelPendingNotifications 之類按 sessionId 的操作誤傷它。課程清單走 payload，
 * 與 coach_booking 的 sessionIds 寫法一致。
 */
export async function enqueueSessionsCancelledDigest(
  db: Db,
  targetLineUserId: string,
  coachId: string,
  sessionIds: string[],
): Promise<void> {
  if (sessionIds.length === 0) return;

  await db.notification.create({
    data: {
      targetLineUserId,
      type: "member_change",
      payload: { kind: "cancelled_digest", sessionIds },
      sendAt: new Date(),
      coachId,
    },
  });
}
