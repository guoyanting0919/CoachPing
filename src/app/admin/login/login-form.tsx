"use client";

import { useActionState } from "react";
import { loginAction, type LoginResult } from "@/lib/admin/actions";

export default function LoginForm() {
  const [state, action, pending] = useActionState<LoginResult, FormData>(
    loginAction,
    null,
  );

  return (
    <form action={action} className="space-y-4">
      <label className="block">
        <span className="text-sm font-medium text-slate-700">管理密碼</span>
        <input
          name="password"
          type="password"
          required
          autoFocus
          autoComplete="current-password"
          className="mt-1.5 w-full rounded-md border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
      </label>

      {state?.error ? <p className="text-sm text-rose-600">{state.error}</p> : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700 disabled:bg-slate-300"
      >
        {pending ? "驗證中…" : "登入"}
      </button>
    </form>
  );
}
