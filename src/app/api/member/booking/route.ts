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
    // 開關開著但沒有任何可預約時段。對學員而言與關閉無法區分，也不該區分——
    // closed 讓前端說「這位教練目前不開放預約」，而不是拿 remaining: 0
    // 去走「你已經約滿了」那條路，那是完全不同的原因。
    return Response.json({
      coaches: candidates.map((c) => ({ id: c.id, name: c.name })),
      selected: {
        coachId,
        coachName: candidates.find((c) => c.id === coachId)?.name ?? "",
        closed: true,
        durationMin: 0,
        leadHours: 0,
        remaining: 0,
        maxOpenBookings: 0,
        openBookings: 0,
        horizonDays: BOOKING_HORIZON_DAYS,
        days: [],
      },
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
      /** 教練設定的總上限。與 remaining 併用才說得清「已有 N 堂未上課」。 */
      maxOpenBookings: ctx.coach.maxOpenBookings,
      openBookings: open,
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
  /**
   * 一次可約多堂，上限為教練的 max_open_bookings（最大 20，見 settings 的 schema）。
   * 每一個都必須是 GET 回傳過的格子，但伺服器不信任這份清單，會自己重算一次。
   */
  startAts: z.array(z.string().datetime()).min(1).max(20),
});

export async function POST(req: Request): Promise<Response> {
  const auth = await requireMember(req);
  if (!auth.ok) return auth.response;
  const member = auth.value;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400 });

  // 去重後排序：前端理應不會送重複的，但重複送進來會變成同一時段兩堂課。
  const startAts = [...new Set(parsed.data.startAts)]
    .map((iso) => new Date(iso))
    .sort((a, b) => a.getTime() - b.getTime());
  const now = new Date();

  const link = await prisma.coachMember.findUnique({
    where: { coachId_memberId: { coachId: parsed.data.coachId, memberId: member.id } },
    select: { status: true },
  });
  if (!link || link.status !== "active") {
    return Response.json({ error: "coach_not_bookable" }, { status: 403 });
  }

  let outcome: { sessionIds: string[] };

  try {
    outcome = await prisma.$transaction(async (tx) => {
      // 同一位教練的預約寫入互斥。少了這把鎖，兩個請求可以雙雙讀到「這格是空的」
      // 然後雙雙寫入——結果是兩個都成功、沒有人看到「已被預約」，而發現問題的人是教練。
      // 刻意不用 sessions(coach_id, start_at) 的唯一索引：那會弄壞教練帶 force
      // 刻意排重疊課的既有功能（SPEC.md §3.4）。
      //
      // 必須用 $executeRaw 而非 $queryRaw：pg_advisory_xact_lock 回傳 void，
      // 而 $queryRaw 會試圖反序列化結果欄位、對 void 直接拋 P2010。
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${parsed.data.coachId}))`;

      const ctx = await loadBookingContext(tx, parsed.data.coachId, now);
      if (!ctx) throw new BookingError("coach_not_bookable");

      const open = await countOpenBookings(tx, parsed.data.coachId, member.id, now);
      if (open + startAts.length > ctx.coach.maxOpenBookings) {
        throw new BookingError("too_many_bookings");
      }

      // 選中的格子彼此不能重疊。時長不是 30 的倍數時（或任何時長），
      // 09:00 與 09:30 會同時是可選的——各自都沒被佔用，但一起約就讓教練撞課。
      // 前端已經擋掉，這裡是真正的防線。
      for (let i = 1; i < startAts.length; i++) {
        const gap = startAts[i].getTime() - startAts[i - 1].getTime();
        if (gap < ctx.coach.defaultDuration * 60_000) {
          throw new BookingError("slots_overlap");
        }
      }

      // 在鎖內重算一次，不信任前端畫面上的格子——那張表可能是十分鐘前載入的。
      const days = computeOpenSlots({
        availability: ctx.availability,
        blocks: ctx.blocks,
        busy: ctx.busy,
        durationMin: ctx.coach.defaultDuration,
        leadHours: ctx.coach.bookingLeadHours,
        now,
      });
      const openSet = new Set(
        days.flatMap((d) => d.starts.map((s) => s.getTime())),
      );
      // 全有全無：只要有一個格子被搶走就整批失敗，前端重抓後重選。
      // 部分成功會逼出「哪幾堂成立了」的一整套額外語義，而學員在按下確認時
      // 想的是「這三堂」，不是「這三堂裡能約到幾堂算幾堂」。
      if (startAts.some((at) => !openSet.has(at.getTime()))) {
        throw new BookingError("slot_taken");
      }

      const sessionIds: string[] = [];
      for (const startAt of startAts) {
        const session = await tx.session.create({
          data: {
            coachId: parsed.data.coachId,
            startAt,
            durationMin: ctx.coach.defaultDuration,
            origin: "member_booked",
            // 預約一律建立只有自己一人的新課，不併入他人已有的課（SPEC.md §3.6）。
            // 多堂之間也不串 seriesId——它們是各自獨立選的時段，不是週期性系列。
            participants: { create: [{ memberId: member.id }] },
          },
          select: { id: true },
        });
        sessionIds.push(session.id);
      }

      // 建課、課前提醒、教練通知必須同時成立，否則會出現
      // 「課排好了但沒人會被通知」或「通知了教練但課不存在」。
      await enqueueSessionReminders(tx, sessionIds);
      // 一次預約一則通知，不論約了幾堂。
      await enqueueCoachBooking(
        tx,
        sessionIds,
        ctx.coach.lineUserId,
        parsed.data.coachId,
      );

      return { sessionIds };
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

  return Response.json({ sessionIds: outcome.sessionIds });
}

class BookingError extends Error {
  constructor(
    readonly code:
      | "coach_not_bookable"
      | "too_many_bookings"
      | "slot_taken"
      | "slots_overlap",
  ) {
    super(code);
  }
}
