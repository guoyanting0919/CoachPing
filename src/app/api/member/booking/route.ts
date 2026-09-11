import { z } from "zod";
import { requireMember } from "@/lib/auth";
import { BOOKING_HORIZON_DAYS, computeOpenSlots } from "@/lib/booking";
import { countOpenBookings, loadBookingContext } from "@/lib/booking-store";
import { flushNotifications } from "@/lib/dispatch";
import { enqueueCoachBooking, enqueueSessionReminders } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 學員預約（SPEC.md §3.6）。
 *
 * GET  不帶 coachId → 可預約的教練清單。剛好一位時連同他的時段一起回，
 *      前端就不必為最常見的情況多跑一趟（SPEC.md §3.6 的動線 (c)）。
 * GET  帶 coachId   → 該教練未來 30 天的可預約格子。
 * POST                建立預約。
 */
export async function GET(req: Request): Promise<Response> {
  const auth = await requireMember(req);
  if (!auth.ok) return auth.response;

  const now = new Date();
  const requested = new URL(req.url).searchParams.get("coachId");

  // 只列這位學員自己的教練，且關係仍有效。少了 status 這道，停用的關係還能約課。
  const links = await prisma.coachMember.findMany({
    where: { memberId: auth.value.id, status: "active" },
    orderBy: { createdAt: "asc" },
    select: { coach: { select: { id: true, name: true, bookingEnabled: true } } },
  });

  // 「開放預約」為真才是候選；真正有沒有時段由 loadBookingContext 決定。
  const candidates = links.map((l) => l.coach).filter((c) => c.bookingEnabled);

  if (requested && !candidates.some((c) => c.id === requested)) {
    return Response.json({ error: "coach_not_bookable" }, { status: 404 });
  }

  const coachId = requested ?? (candidates.length === 1 ? candidates[0].id : null);
  if (!coachId) {
    return Response.json({
      coaches: candidates.map((c) => ({ id: c.id, name: c.name })),
      selected: null,
    });
  }

  const ctx = await loadBookingContext(prisma, coachId, now);
  if (!ctx) {
    // 開關開著但沒有時段。對學員而言與關閉無法區分，也不該區分。
    return Response.json({
      coaches: candidates.map((c) => ({ id: c.id, name: c.name })),
      selected: { coachId, coachName: "", durationMin: 0, days: [], remaining: 0 },
    });
  }

  const open = await countOpenBookings(prisma, coachId, auth.value.id, now);

  const days = computeOpenSlots({
    availability: ctx.availability,
    blocks: ctx.blocks,
    busy: ctx.busy,
    durationMin: ctx.coach.defaultDuration,
    leadHours: ctx.coach.bookingLeadHours,
    now,
  });

  return Response.json({
    coaches: candidates.map((c) => ({ id: c.id, name: c.name })),
    selected: {
      coachId,
      coachName: ctx.coach.name,
      durationMin: ctx.coach.defaultDuration,
      leadHours: ctx.coach.bookingLeadHours,
      /** 還能再約幾堂。0 時前端停用所有格子並說明原因。 */
      remaining: Math.max(0, ctx.coach.maxOpenBookings - open),
      horizonDays: BOOKING_HORIZON_DAYS,
      days: days.map((d) => ({
        date: d.date,
        starts: d.starts.map((s) => s.toISOString()),
      })),
    },
  });
}

const createSchema = z.object({
  coachId: z.string().min(1),
  /** 必須是 GET 回傳過的某個格子。伺服器不信任這個值，會自己重算一次。 */
  startAt: z.string().datetime(),
});

export async function POST(req: Request): Promise<Response> {
  const auth = await requireMember(req);
  if (!auth.ok) return auth.response;
  const member = auth.value;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400 });

  const startAt = new Date(parsed.data.startAt);
  const now = new Date();

  const link = await prisma.coachMember.findUnique({
    where: { coachId_memberId: { coachId: parsed.data.coachId, memberId: member.id } },
    select: { status: true },
  });
  if (!link || link.status !== "active") {
    return Response.json({ error: "coach_not_bookable" }, { status: 403 });
  }

  let outcome: { sessionId: string; coachLineUserId: string; coachId: string };

  try {
    outcome = await prisma.$transaction(async (tx) => {
      // 同一位教練的預約寫入互斥。少了這把鎖，兩個請求可以雙雙讀到「這格是空的」
      // 然後雙雙寫入——結果是兩個都成功、沒有人看到「已被預約」，而發現問題的人是教練。
      // 刻意不用 sessions(coach_id, start_at) 的唯一索引：那會弄壞教練帶 force
      // 刻意排重疊課的既有功能（SPEC.md §3.4）。
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${parsed.data.coachId}))`;

      const ctx = await loadBookingContext(tx, parsed.data.coachId, now);
      if (!ctx) throw new BookingError("coach_not_bookable");

      const open = await countOpenBookings(tx, parsed.data.coachId, member.id, now);
      if (open >= ctx.coach.maxOpenBookings) throw new BookingError("too_many_bookings");

      // 在鎖內重算一次，不信任前端畫面上的格子——那張表可能是十分鐘前載入的。
      const days = computeOpenSlots({
        availability: ctx.availability,
        blocks: ctx.blocks,
        busy: ctx.busy,
        durationMin: ctx.coach.defaultDuration,
        leadHours: ctx.coach.bookingLeadHours,
        now,
      });
      const stillOpen = days.some((d) =>
        d.starts.some((s) => s.getTime() === startAt.getTime()),
      );
      if (!stillOpen) throw new BookingError("slot_taken");

      const session = await tx.session.create({
        data: {
          coachId: parsed.data.coachId,
          startAt,
          durationMin: ctx.coach.defaultDuration,
          origin: "member_booked",
          // 預約一律建立只有自己一人的新課，不併入他人已有的課（SPEC.md §3.6）。
          participants: { create: [{ memberId: member.id }] },
        },
        select: { id: true },
      });

      // 建課、課前提醒、教練通知必須同時成立，否則會出現
      // 「課排好了但沒人會被通知」或「通知了教練但課不存在」。
      await enqueueSessionReminders(tx, [session.id]);
      await enqueueCoachBooking(
        tx,
        session.id,
        ctx.coach.lineUserId,
        parsed.data.coachId,
      );

      return {
        sessionId: session.id,
        coachLineUserId: ctx.coach.lineUserId,
        coachId: parsed.data.coachId,
      };
    });
  } catch (err) {
    if (err instanceof BookingError) {
      // slot_taken 回 409，前端據此重抓時段表並說明「這個時段剛被約走了」。
      const status = err.code === "slot_taken" ? 409 : 403;
      return Response.json({ error: err.code }, { status });
    }
    throw err;
  }

  // 教練在等這則預約通知，不能等到下一次 cron（最長 30 分鐘）。
  flushNotifications();

  return Response.json({ sessionId: outcome.sessionId });
}

class BookingError extends Error {
  constructor(readonly code: "coach_not_bookable" | "too_many_bookings" | "slot_taken") {
    super(code);
  }
}
