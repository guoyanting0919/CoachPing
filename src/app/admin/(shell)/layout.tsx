import { logoutAction } from "@/lib/admin/actions";
import Nav from "../nav";

/**
 * 後台外框（SPEC.md §16）。
 *
 * 注意這裡**沒有**做身分驗證。Next.js 文件明講 layout 的檢查不足夠：
 * layout 不會在每次導航都重跑，巢狀 segment 與 Server Action 都會繞過它。
 * 真正的門在每個 query／action 第一行的 requireAdmin()。
 *
 * 登入頁不在這個 route group 裡，所以不會套到這層外框。
 */
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="flex min-h-dvh bg-slate-100 font-sans text-slate-900">
      <aside className="flex w-56 shrink-0 flex-col bg-slate-900 py-5">
        <div className="px-6 pb-6">
          <p className="text-sm font-semibold text-white">CoachPing</p>
          <p className="mt-0.5 text-xs text-slate-500">管理後台</p>
        </div>

        <Nav />

        <form action={logoutAction} className="mt-auto px-3 pt-6">
          <button
            type="submit"
            className="w-full rounded-md px-3 py-2 text-left text-sm text-slate-400 transition hover:bg-white/5 hover:text-slate-200"
          >
            登出
          </button>
        </form>
      </aside>

      <main className="min-w-0 flex-1 px-8 py-8">{children}</main>
    </div>
  );
}
