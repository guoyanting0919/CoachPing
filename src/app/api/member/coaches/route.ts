import { requireMember } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 學員的教練清單。Rich Menu 的「聯絡教練」導到這裡——
 * 選單是全體共用的，寫死單一網址無法涵蓋跨教練的學員（SPEC.md §7）。
 */
export async function GET(req: Request): Promise<Response> {
  const auth = await requireMember(req);
  if (!auth.ok) return auth.response;

  const links = await prisma.coachMember.findMany({
    where: { memberId: auth.value.id, status: "active" },
    orderBy: { createdAt: "asc" },
    select: { coach: { select: { id: true, name: true, oaUrl: true } } },
  });

  return Response.json({
    coaches: links.map((l) => ({
      id: l.coach.id,
      name: l.coach.name,
      oaUrl: l.coach.oaUrl,
    })),
  });
}
