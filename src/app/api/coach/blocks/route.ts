import { z } from "zod";
import { requireCoach } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { taipeiDateTime } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * 封鎖時段（SPEC.md §3.7）。只能收回，不能加開。
 * 只回傳尚未結束的——過去的封鎖對任何決定都沒有影響，列出來只是雜訊。
 */
export async function GET(req: Request): Promise<Response> {
  const auth = await requireCoach(req);
  if (!auth.ok) return auth.response;

  const blocks = await prisma.coachBlock.findMany({
    where: { coachId: auth.value.id, endAt: { gte: new Date() } },
    orderBy: { startAt: "asc" },
    select: { id: true, startAt: true, endAt: true, reason: true },
  });

  return Response.json({
    blocks: blocks.map((b) => ({
      id: b.id,
      startAt: b.startAt.toISOString(),
      endAt: b.endAt.toISOString(),
      reason: b.reason,
    })),
  });
}

const createSchema = z
  .object({
    /** 台北時間的日期。跨日封鎖（出國一週）以 startDate ≠ endDate 表達。 */
    startDate: z.string().regex(YMD),
    endDate: z.string().regex(YMD),
    /** allDay 為真時忽略這兩個欄位。 */
    allDay: z.boolean().default(true),
    startTime: z.string().regex(HHMM).optional(),
    endTime: z.string().regex(HHMM).optional(),
    reason: z.string().trim().max(100).optional(),
  })
  .refine((v) => v.allDay || (v.startTime !== undefined && v.endTime !== undefined), {
    message: "time_required",
  });

export async function POST(req: Request): Promise<Response> {
  const auth = await requireCoach(req);
  if (!auth.ok) return auth.response;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400 });
  const body = parsed.data;

  // 整天 = 當日 00:00 至「結束日的次日」00:00，這樣單日整天封鎖也是完整的 24 小時。
  const startAt = body.allDay
    ? taipeiDateTime(body.startDate, "00:00")
    : taipeiDateTime(body.startDate, body.startTime!);
  const endAt = body.allDay
    ? new Date(taipeiDateTime(body.endDate, "00:00").getTime() + 24 * 60 * 60 * 1000)
    : taipeiDateTime(body.endDate, body.endTime!);

  if (endAt <= startAt) return Response.json({ error: "invalid_range" }, { status: 400 });

  const block = await prisma.coachBlock.create({
    data: { coachId: auth.value.id, startAt, endAt, reason: body.reason || null },
    select: { id: true },
  });

  // 刻意不動既有課程：已排定或已被預約的課不因新增封鎖而消失（SPEC.md §3.7）。
  // 封鎖只讓那段時間不再產生新的可預約格子。
  return Response.json({ id: block.id });
}
