import { requireCoach } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireCoach(req);
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;

  // 條件帶 coachId：少了它任何教練都能刪掉別人的封鎖時段。
  const deleted = await prisma.coachBlock.deleteMany({
    where: { id, coachId: auth.value.id },
  });
  if (deleted.count === 0) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  return Response.json({ ok: true });
}
