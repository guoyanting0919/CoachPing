import type { PrismaClient } from "@/generated/prisma/client";
import type { Block, Busy, Interval } from "./booking";
import { BOOKING_HORIZON_DAYS } from "./booking";

/**
 * 預約格子計算所需的資料查詢（SPEC.md §3.6）。
 *
 * 與 booking.ts 的純函式分開，但**刻意只有這一支**：學員查詢可選時段與真正送出預約
 * 必須看到完全相同的輸入，否則畫面上有的格子送出時會被拒、或反之。
 * 兩條路徑共用這裡，它們就不可能各自漂移。
 */

type Db = PrismaClient | Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export type BookingCoach = {
  id: string;
  name: string;
  lineUserId: string;
  defaultDuration: number;
  bookingLeadHours: number;
  maxOpenBookings: number;
};

export type BookingContext = {
  coach: BookingCoach;
  availability: Interval[];
  blocks: Block[];
  busy: Busy[];
};

/**
 * 載入某位教練的可預約狀態。
 * 回 null 表示這位教練現在不接受預約——不論是總開關關著，或開著但沒有任何時段
 * （兩者都等於關，SPEC.md §3.6）。
 */
export async function loadBookingContext(
  db: Db,
  coachId: string,
  now: Date,
): Promise<BookingContext | null> {
  const coach = await db.coach.findUnique({
    where: { id: coachId },
    select: {
      id: true,
      name: true,
      lineUserId: true,
      defaultDuration: true,
      bookingEnabled: true,
      bookingLeadHours: true,
      maxOpenBookings: true,
    },
  });
  if (!coach || !coach.bookingEnabled) return null;

  const availability = await db.coachAvailability.findMany({
    where: { coachId },
    select: { weekday: true, startMin: true, endMin: true },
  });
  if (availability.length === 0) return null;

  // 視野終點多留一天：最後一天的課可能跨過午夜，範圍剛好切在邊界會漏掉衝突。
  const windowEnd = new Date(now.getTime() + (BOOKING_HORIZON_DAYS + 1) * 24 * 60 * 60 * 1000);

  const [blocks, busy] = await Promise.all([
    db.coachBlock.findMany({
      where: { coachId, endAt: { gte: now }, startAt: { lte: windowEnd } },
      select: { startAt: true, endAt: true },
    }),
    loadBusy(db, coach.lineUserId, coachId, now, windowEnd),
  ]);

  return { coach, availability, blocks, busy };
}

/**
 * 教練那段時間裡已經被佔用的時刻：他自己要教的課，加上他當**別人**學員時要上的課。
 * 後者是雙重身分的情形（SPEC.md §2）——漏掉它會讓學員約到教練自己要去上課的時間。
 */
async function loadBusy(
  db: Db,
  coachLineUserId: string,
  coachId: string,
  from: Date,
  to: Date,
): Promise<Busy[]> {
  const window = { status: "scheduled" as const, startAt: { gte: from, lte: to } };

  const teaching = await db.session.findMany({
    where: { coachId, ...window },
    select: { startAt: true, durationMin: true },
  });

  const asMember = await db.member.findUnique({
    where: { lineUserId: coachLineUserId },
    select: { id: true },
  });
  if (!asMember) return teaching;

  const studying = await db.session.findMany({
    where: { participants: { some: { memberId: asMember.id } }, ...window },
    select: { startAt: true, durationMin: true },
  });

  return [...teaching, ...studying];
}

/**
 * 這位學員在這位教練那裡有幾筆尚未上課的預約。
 * 只數 `member_booked`：教練主動排的課不該吃掉學員的預約額度。
 */
export function countOpenBookings(
  db: Db,
  coachId: string,
  memberId: string,
  now: Date,
): Promise<number> {
  return db.session.count({
    where: {
      coachId,
      origin: "member_booked",
      status: "scheduled",
      startAt: { gte: now },
      participants: { some: { memberId } },
    },
  });
}
