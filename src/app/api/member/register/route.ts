import { z } from "zod";
import { verifyIdToken } from "@/lib/liff-auth";
import { bindRichMenu } from "@/lib/line";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  idToken: z.string().min(1),
  inviteToken: z.string().min(1),
  name: z.string().trim().min(1).max(40),
});

export async function POST(req: Request): Promise<Response> {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  const { idToken, inviteToken, name } = parsed.data;

  const verified = await verifyIdToken(idToken);
  if (!verified) {
    return Response.json({ error: "invalid_id_token" }, { status: 401 });
  }

  const invite = await prisma.invite.findUnique({ where: { token: inviteToken } });
  if (!invite) return Response.json({ error: "invite_not_found" }, { status: 404 });
  if (invite.usedAt) return Response.json({ error: "invite_used" }, { status: 409 });
  if (invite.expiresAt < new Date()) {
    return Response.json({ error: "invite_expired" }, { status: 410 });
  }

  // 這位 LINE 使用者是否已經是別的教練的學員？
  // 連鎖健身房情境下這是常態（SPEC.md §4 師生關係為多對多）。
  const existing = await prisma.member.findUnique({
    where: { lineUserId: verified.userId },
    select: { id: true },
  });

  const memberId = await prisma.$transaction(async (tx) => {
    const placeholderId = invite.memberId;

    if (!existing) {
      // 首次註冊：直接把教練先前建立的佔位記錄補完。
      await tx.member.update({
        where: { id: placeholderId },
        data: { lineUserId: verified.userId, displayName: name },
      });
      await tx.coachMember.update({
        where: { coachId_memberId: { coachId: invite.coachId, memberId: placeholderId } },
        data: { displayName: name },
      });
      await tx.invite.update({
        where: { token: inviteToken },
        data: { usedAt: new Date() },
      });
      return placeholderId;
    }

    if (existing.id === placeholderId) {
      // 同一筆記錄重複點擊，冪等處理。
      await tx.coachMember.update({
        where: { coachId_memberId: { coachId: invite.coachId, memberId: placeholderId } },
        data: { displayName: name, status: "active" },
      });
      await tx.invite.update({
        where: { token: inviteToken },
        data: { usedAt: new Date() },
      });
      return placeholderId;
    }

    // 合併：這個人已經有 member 記錄，教練建立的佔位記錄要併過去，
    // 否則同一個人會在系統裡有兩筆資料，永遠洗不乾淨。
    // 佔位記錄上可能已經有教練排好的課，必須一併搬移。
    const placeholderSessions = await tx.sessionParticipant.findMany({
      where: { memberId: placeholderId },
      select: { sessionId: true },
    });
    const sessionIds = placeholderSessions.map((s) => s.sessionId);

    if (sessionIds.length) {
      // 目標學員已在其中的課程不能重複插入（複合主鍵會衝突），先找出來排除。
      const alreadyIn = await tx.sessionParticipant.findMany({
        where: { memberId: existing.id, sessionId: { in: sessionIds } },
        select: { sessionId: true },
      });
      const skip = new Set(alreadyIn.map((s) => s.sessionId));

      await tx.sessionParticipant.deleteMany({ where: { memberId: placeholderId } });
      await tx.sessionParticipant.createMany({
        data: sessionIds
          .filter((id) => !skip.has(id))
          .map((sessionId) => ({ sessionId, memberId: existing.id })),
      });
    }

    await tx.coachMember.deleteMany({
      where: { coachId: invite.coachId, memberId: placeholderId },
    });
    await tx.coachMember.upsert({
      where: { coachId_memberId: { coachId: invite.coachId, memberId: existing.id } },
      create: {
        coachId: invite.coachId,
        memberId: existing.id,
        displayName: name,
      },
      update: { displayName: name, status: "active" },
    });

    // 佔位記錄的其他邀請也要改指向，否則刪除時外鍵會擋住。
    await tx.invite.updateMany({
      where: { memberId: placeholderId },
      data: { memberId: existing.id },
    });
    await tx.invite.update({
      where: { token: inviteToken },
      data: { usedAt: new Date() },
    });

    await tx.member.delete({ where: { id: placeholderId } });

    return existing.id;
  });

  try {
    await bindRichMenu(verified.userId, "member");
  } catch (err) {
    console.error("[member-register] Rich Menu 綁定失敗", err);
  }

  return Response.json({ ok: true, memberId });
}
