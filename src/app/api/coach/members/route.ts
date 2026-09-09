import { z } from "zod";
import { inviteExpiry, inviteUrl, requireCoach } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 教練的學員清單，含連結狀態與「已連結 X／共 Y」指標（SPEC.md §8）。 */
export async function GET(req: Request): Promise<Response> {
  const auth = await requireCoach(req);
  if (!auth.ok) return auth.response;

  const links = await prisma.coachMember.findMany({
    where: { coachId: auth.value.id, status: "active" },
    orderBy: { createdAt: "asc" },
    select: {
      createdAt: true,
      displayName: true,
      member: {
        select: { id: true, lineUserId: true, lineBlocked: true },
      },
    },
  });

  // 未連結的學員需要邀請連結才能催他加入，一併撈出來省一次往返。
  const pendingInvites = await prisma.invite.findMany({
    where: {
      coachId: auth.value.id,
      usedAt: null,
      expiresAt: { gt: new Date() },
      memberId: { in: links.map((l) => l.member.id) },
    },
    select: { token: true, memberId: true },
  });
  const inviteByMember = new Map(pendingInvites.map((i) => [i.memberId, i.token]));

  const members = links.map(({ member, displayName }) => ({
    id: member.id,
    name: displayName,
    linked: member.lineUserId !== null,
    blocked: member.lineBlocked,
    inviteUrl: member.lineUserId ? null : (inviteByMember.get(member.id) ?? null),
  })).map((m) => ({
    ...m,
    inviteUrl: m.inviteUrl ? inviteUrl(m.inviteUrl) : null,
  }));

  return Response.json({
    members,
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
