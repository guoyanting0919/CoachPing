import { z } from "zod";
import { requireCoach } from "@/lib/auth";
import { normalizeIntervals } from "@/lib/booking";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 教練的可預約時段（SPEC.md §3.6）。
 * 讀寫都是「整週一次」——逐筆增刪會讓前端得自己追蹤哪幾段被改過，
 * 而整週替換讓正規化（合併重疊與相鄰）只需要在一個地方發生。
 */
export async function GET(req: Request): Promise<Response> {
  const auth = await requireCoach(req);
  if (!auth.ok) return auth.response;

  const intervals = await prisma.coachAvailability.findMany({
    where: { coachId: auth.value.id },
    orderBy: [{ weekday: "asc" }, { startMin: "asc" }],
    select: { weekday: true, startMin: true, endMin: true },
  });

  return Response.json({ intervals });
}

const putSchema = z.object({
  intervals: z
    .array(
      z.object({
        weekday: z.number().int().min(0).max(6),
        startMin: z.number().int().min(0).max(1440),
        endMin: z.number().int().min(0).max(1440),
      }),
    )
    // 七天 × 每天幾段，給足空間但不讓人塞爆。
    .max(70),
});

export async function PUT(req: Request): Promise<Response> {
  const auth = await requireCoach(req);
  if (!auth.ok) return auth.response;

  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400 });

  // 正規化在伺服器端做，不信任前端送來的形狀：無效區間丟掉、重疊與相鄰合併。
  const intervals = normalizeIntervals(parsed.data.intervals);

  // 刪掉再建立必須同時成立，否則會出現「舊的刪了、新的沒進去」= 預約整個關掉。
  await prisma.$transaction(async (tx) => {
    await tx.coachAvailability.deleteMany({ where: { coachId: auth.value.id } });
    if (intervals.length > 0) {
      await tx.coachAvailability.createMany({
        data: intervals.map((iv) => ({ ...iv, coachId: auth.value.id })),
      });
    }
  });

  return Response.json({ intervals });
}
