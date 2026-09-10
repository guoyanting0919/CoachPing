import LoginForm from "./login-form";

export const metadata = { title: "管理後台" };

/**
 * 登入頁刻意放在 (shell) route group 之外，因此不套側邊欄外框。
 * proxy.ts 也把這條路徑排除在導向規則外，否則會無限重導。
 */
export default function AdminLoginPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-100 px-6 font-sans">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <p className="text-lg font-semibold text-slate-900">CoachPing 管理後台</p>
          <p className="mt-1 text-sm text-slate-500">僅供開發者使用</p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <LoginForm />
        </div>
      </div>
    </div>
  );
}
