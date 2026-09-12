import { z } from "zod";
import { inviteExpiry, inviteUrl, requireCoach } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 教練的學員清單（SPEC.md §8）。進行中與已結束的關係一次回兩組——
 * 清單都很小，切分頁不該再等一次 loading。
 *
 * 「已連結 X／共 Y」只算進行中的關係：把三個月前結束的舊帳算進分母，
 * 這個指標永遠清不到 100%，也就廢了。
 */
export async function GET(req: Request): Promise<Response> {
  const auth = await requireCoach(req);
  if (!auth.ok) return auth.response;

  const links = await prisma.coachMember.findMany({
    where: { coachId: auth.value.id },
    orderBy: { createdAt: "asc" },
    select: {
      status: true,
      endedAt: true,
      displayName: true,
      member: {
        select: { id: true, lineUserId: true, lineBlocked: true },
      },
    },
  });

  const active = links.filter((l) => l.status === "active");

  // 未連結的學員需要邀請連結才能催他加入，一併撈出來省一次往返。
  const pendingInvites = await prisma.invite.findMany({
    where: {
      coachId: auth.value.id,
      usedAt: null,
      expiresAt: { gt: new Date() },
      memberId: { in: active.map((l) => l.member.id) },
    },
    select: { token: true, memberId: true },
  });
  const inviteByMember = new Map(pendingInvites.map((i) => [i.memberId, i.token]));

  // 結束合作的確認畫面要講「同時取消未來的 N 堂課」，那個 N 在這裡算好。
  const futureCounts = await prisma.sessionParticipant.groupBy({
    by: ["memberId"],
    where: {
      memberId: { in: active.map((l) => l.member.id) },
      session: {
        coachId: auth.value.id,
        status: "scheduled",
        startAt: { gte: new Date() },
      },
    },
    _count: { sessionId: true },
  });
  const futureByMember = new Map(
    futureCounts.map((c) => [c.memberId, c._count.sessionId]),
  );

  const members = active.map(({ member, displayName }) => {
    const token = member.lineUserId ? null : inviteByMember.get(member.id);
    return {
      id: member.id,
      name: displayName,
      linked: member.lineUserId !== null,
      blocked: member.lineBlocked,
      inviteUrl: token ? inviteUrl(token) : null,
      futureSessionCount: futureByMember.get(member.id) ?? 0,
    };
  });

  const ended = links
    .filter((l) => l.status === "inactive")
    .map(({ member, displayName, endedAt }) => ({
      id: member.id,
      name: displayName,
      linked: member.lineUserId !== null,
      endedAt: endedAt?.toISOString() ?? null,
    }))
    // 近期結束的排前面：教練要找的通常是剛才手滑那一筆。
    .sort((a, b) => (b.endedAt ?? "").localeCompare(a.endedAt ?? ""));

  return Response.json({
    members,
    ended,
    linkedCount: members.filter((m) => m.linked).length,
    totalCount: members.length,
  });
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(40),
});

/**
 * 新增學員並產生一次性邀請連結（SPEC.md §3.2）。
 * 先建立 member 記錄（line_user_id 為 null）讓教練可以立刻排課，
 * 不必等學員完成註冊。
 */
export async function POST(req: Request): Promise<Response> {
  const auth = await requireCoach(req);
  if (!auth.ok) return auth.response;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const result = await prisma.$transaction(async (tx) => {
    const member = await tx.member.create({
      data: { displayName: parsed.data.name },
    });

    await tx.coachMember.create({
      data: {
        coachId: auth.value.id,
        memberId: member.id,
        displayName: parsed.data.name,
      },
    });

    const invite = await tx.invite.create({
      data: {
        coachId: auth.value.id,
        memberId: member.id,
        expiresAt: inviteExpiry(),
      },
    });

    return { member, invite };
  });

  return Response.json({
    member: { id: result.member.id, name: result.member.displayName },
    inviteUrl: inviteUrl(result.invite.token),
  });
}
