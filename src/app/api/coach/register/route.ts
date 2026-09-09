import { z } from "zod";
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
    await bindRichMenu(verified.userId, "coach");
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
  const coach = await prisma.$transaction(async (tx) => {
    const created = await tx.coach.create({
      data: {
        lineUserId: verified.userId,
        name: body.name,
        oaUrl,
        defaultDuration: body.defaultDuration,
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
  try {
    await bindRichMenu(verified.userId, "coach");
  } catch (err) {
    console.error("[register] Rich Menu 綁定失敗", err);
  }

  return Response.json({ ok: true, coachId: coach.id });
}
