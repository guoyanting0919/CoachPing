import { z } from "zod";
import { requireCoach } from "@/lib/auth";
import { normalizeOaUrl } from "@/lib/liff-auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const auth = await requireCoach(req);
  if (!auth.ok) return auth.response;
  const c = auth.value;

  return Response.json({
    name: c.name,
    oaUrl: c.oaUrl,
    defaultDuration: c.defaultDuration,
    reminderHours: c.reminderHours,
    leaveDeadlineHours: c.leaveDeadlineHours,
    bookingEnabled: c.bookingEnabled,
    bookingLeadHours: c.bookingLeadHours,
    maxOpenBookings: c.maxOpenBookings,
    // 訂閱網址含秘密代號，只回給本人。
    icalUrl: `${process.env.APP_BASE_URL}/api/calendar/${c.icalToken}.ics`,
  });
}

const patchSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  oaUrl: z.string().trim().min(1).max(200).optional(),
  defaultDuration: z.number().int().min(15).max(240).optional(),
  reminderHours: z.number().int().min(1).max(72).optional(),
  leaveDeadlineHours: z.number().int().min(0).max(168).optional(),
  bookingEnabled: z.boolean().optional(),
  bookingLeadHours: z.number().int().min(0).max(168).optional(),
  maxOpenBookings: z.number().int().min(1).max(20).optional(),
});

export async function PATCH(req: Request): Promise<Response> {
  const auth = await requireCoach(req);
  if (!auth.ok) return auth.response;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400 });
  const body = parsed.data;

  let oaUrl: string | undefined;
  if (body.oaUrl !== undefined) {
    const normalized = normalizeOaUrl(body.oaUrl);
    if (!normalized) return Response.json({ error: "invalid_oa_url" }, { status: 400 });
    oaUrl = normalized;
  }

  // 提醒時數變動不回頭調整既有佇列：那會讓已排定的提醒集體位移，
  // 學員可能因此在半夜收到通知。新排的課才套用新設定。
  await prisma.coach.update({
    where: { id: auth.value.id },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(oaUrl !== undefined ? { oaUrl } : {}),
      ...(body.defaultDuration !== undefined
        ? { defaultDuration: body.defaultDuration }
        : {}),
      ...(body.reminderHours !== undefined ? { reminderHours: body.reminderHours } : {}),
      ...(body.leaveDeadlineHours !== undefined
        ? { leaveDeadlineHours: body.leaveDeadlineHours }
        : {}),
      ...(body.bookingEnabled !== undefined
        ? { bookingEnabled: body.bookingEnabled }
        : {}),
      ...(body.bookingLeadHours !== undefined
        ? { bookingLeadHours: body.bookingLeadHours }
        : {}),
      ...(body.maxOpenBookings !== undefined
        ? { maxOpenBookings: body.maxOpenBookings }
        : {}),
    },
  });

  return Response.json({ ok: true });
}
