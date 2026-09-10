import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Next.js 16 把 middleware 改名為 proxy，功能不變。
 *
 * 這裡只做「沒有 cookie 就導去登入頁」的樂觀檢查，**不是安全邊界**：
 * 不驗簽章（proxy 跑在 edge runtime，拿不到 node:crypto），
 * 也擋不住 Server Action（action 的 POST 可能打在別的路徑上）。
 * 真正的門在 src/lib/admin/session.ts 的 requireAdmin()。
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/admin/login") return NextResponse.next();
  if (request.cookies.has("admin_session")) return NextResponse.next();

  return NextResponse.redirect(new URL("/admin/login", request.url));
}

export const config = {
  matcher: ["/admin", "/admin/:path*"],
};
