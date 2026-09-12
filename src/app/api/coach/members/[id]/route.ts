import { z } from "zod";
import { inviteExpiry, inviteUrl, requireCoach } from "@/lib/auth";
import { flushNotifications } from "@/lib/dispatch";
import { removeParticipant } from "@/lib/leave";
import { enqueueSessionsCancelledDigest } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("end"),
    /** 是否同時取消這位學員未來的課。教練在確認畫面勾選，預設是。 */
    cancelFutureSessions: z.boolean(),
  }),
  z.object({ action: z.literal("restore") }),
]);

/**
 * 結束合作／恢復合作（SPEC.md §4）。
 *
 * 什麼都不刪：關係轉 inactive、endedAt 落地，歷史課程與請假記錄全部留著。
 * 轉 inactive 之後學員約不到、教練也排不了——那兩道防線在 api/member/booking
 * 與 api/coach/sessions，本端點不重複實作權限邏輯。
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireCoach(req);
  if (!auth.ok) return auth.response;

  const coachId = auth.value.id;
  const { id: memberId } = await params;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400 });

  // 一律驗證這段關係確實屬於當前教練，否則等於讓任何教練處置他人的學員。
  const link = await prisma.coachMember.findUnique({
    where: { coachId_memberId: { coachId, memberId } },
    select: { status: true, member: { select: { lineUserId: true } } },
  });
  if (!link) return Response.json({ error: "not_found" }, { status: 404 });

  const lineUserId = link.member.lineUserId;

  if (parsed.data.action === "restore") {
    // 已經在合作中就什麼都不做。重複送出不該多產生一張邀請。
    if (link.status === "active") {
      return Response.json({ ok: true, inviteUrl: null });
    }

    const invite = await prisma.$transaction(async (tx) => {
      await tx.coachMember.update({
        where: { coachId_memberId: { coachId, memberId } },
        data: { status: "active", endedAt: null },
      });

      // 當初結束時作廢了他手上那張連結，不補一張新的他就永遠進不來。
      if (lineUserId) return null;
      return tx.invite.create({
        data: { coachId, memberId, expiresAt: inviteExpiry() },
      });
    });

    return Response.json({
      ok: true,
      inviteUrl: invite ? inviteUrl(invite.token) : null,
    });
  }

  // 已經結束就不再動任何東西：重複送出不該第二次取消課、也不該第二次推播。
  if (link.status === "inactive") {
    return Response.json({ ok: true, cancelledSessions: 0, notified: false });
  }

  const now = new Date();
  // 交易的 callback 裡拿不到 parsed.data 的窄化型別，先取出來。
  const { cancelFutureSessions } = parsed.data;

  const cancelled = await prisma.$transaction(async (tx) => {
    await tx.coachMember.update({
      where: { coachId_memberId: { coachId, memberId } },
      data: { status: "inactive", endedAt: now },
    });

    // 還沒兌現的邀請一律作廢。留著的話學員點下去會讓 api/member/register 的
    // upsert 把關係寫回 active 並覆寫教練取的稱呼——關係會自己復活，教練不會知道。
    await tx.invite.deleteMany({ where: { coachId, memberId, usedAt: null } });

    if (!cancelFutureSessions) return [];

    const sessions = await tx.session.findMany({
      where: {
        coachId,
        status: "scheduled",
        startAt: { gte: now },
        participants: { some: { memberId } },
      },
      orderBy: { startAt: "asc" },
      select: { id: true },
    });

    // 一堂一堂移除，不整批取消：多人課只走掉這一位，剩下的人照上（SPEC.md §6）。
    for (const session of sessions) {
      await removeParticipant(tx, session.id, memberId);
    }

    const ids = sessions.map((s) => s.id);
    if (lineUserId) {
      await enqueueSessionsCancelledDigest(tx, lineUserId, coachId, ids);
    }

    return ids;
  });

  // 學員的課表剛剛少了好幾堂，不能讓他等到下一次 cron。
  if (cancelled.length > 0) flushNotifications();

  return Response.json({
    ok: true,
    cancelledSessions: cancelled.length,
    /** 未連結學員推不了，前端要提示教練自己告知（降級流程，SPEC.md §8）。 */
    notified: lineUserId !== null && cancelled.length > 0,
  });
}
