import { z } from "zod";
import { normalizeIntervals } from "@/lib/booking";
import { primaryRole, resolveIdentities } from "@/lib/identity";
import { bindRichMenu } from "@/lib/line";
import { normalizeOaUrl, verifyIdToken } from "@/lib/liff-auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  idToken: z.string().min(1),
  inviteToken: z.string().min(1),
  name: z.string().trim().min(1).max(40),
  oaUrl: z.string().trim().min(1).max(200),
  defaultDuration: z.number().int().min(15).max(240),
  /**
   * 可預約時段（SPEC.md §3.1）。註冊表單只給共用版，前端展開成扁平區間後送來。
   * 選填：漏了只是預約還沒開始運作，不該讓註冊本身失敗。
   */
  availability: z
    .array(
      z.object({
        weekday: z.number().int().min(0).max(6),
        startMin: z.number().int().min(0).max(1440),
        endMin: z.number().int().min(0).max(1440),
      }),
    )
    .max(70)
    .optional(),
});

export async function POST(req: Request): Promise<Response> {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  const body = parsed.data;

  const verified = await verifyIdToken(body.idToken);
  if (!verified) {
    return Response.json({ error: "invalid_id_token" }, { status: 401 });
  }

  const oaUrl = normalizeOaUrl(body.oaUrl);
  if (!oaUrl) {
    return Response.json({ error: "invalid_oa_url" }, { status: 400 });
  }

  // 已註冊過就直接視為成功，讓重複點連結不會壞掉。
  const existing = await prisma.coach.findUnique({
    where: { lineUserId: verified.userId },
    select: { id: true },
  });
  if (existing) {
    await bindRichMenu(verified.userId, primaryRole(await resolveIdentities(verified.userId)));
    return Response.json({ ok: true, coachId: existing.id, alreadyRegistered: true });
  }

  const invite = await prisma.coachInvite.findUnique({
    where: { token: body.inviteToken },
  });
  if (!invite) {
    return Response.json({ error: "invite_not_found" }, { status: 404 });
  }
  if (invite.usedAt) {
    return Response.json({ error: "invite_used" }, { status: 409 });
  }
  if (invite.expiresAt < new Date()) {
    return Response.json({ error: "invite_expired" }, { status: 410 });
  }

  // 建立教練與消耗邀請碼必須同時成立，否則會出現「碼被用掉但沒建帳號」。
  // 正規化在伺服器端做（合併重疊與相鄰），不信任前端送來的形狀。
  const availability = normalizeIntervals(body.availability ?? []);

  const coach = await prisma.$transaction(async (tx) => {
    const created = await tx.coach.create({
      data: {
        lineUserId: verified.userId,
        name: body.name,
        oaUrl,
        defaultDuration: body.defaultDuration,
        // 新教練預設開啟預約——他在註冊表單剛填完時段，開著即刻可用。
        // 既有教練維持關閉（欄位預設值），不做 data migration 猜他們的作息。
        bookingEnabled: availability.length > 0,
        availability: {
          create: availability.map((iv) => ({
            weekday: iv.weekday,
            startMin: iv.startMin,
            endMin: iv.endMin,
          })),
        },
      },
    });

    // 條件更新：若同時有另一個請求先用掉這組碼，這裡會更新 0 筆而拋錯回滾。
    const consumed = await tx.coachInvite.updateMany({
      where: { token: invite.token, usedAt: null },
      data: { usedAt: new Date(), coachId: created.id },
    });
    if (consumed.count !== 1) {
      throw new Error("invite_race");
    }

    return created;
  });

  // Rich Menu 綁定失敗不該讓註冊失敗——資料已經建好，選單可事後補綁。
  // 這個人可能早就是別的教練的學員，那 primaryRole 會給出 coach_dual。
  try {
    await bindRichMenu(verified.userId, primaryRole(await resolveIdentities(verified.userId)));
  } catch (err) {
    console.error("[register] Rich Menu 綁定失敗", err);
  }

  return Response.json({ ok: true, coachId: coach.id });
}
