"use client";

import { useActionState } from "react";
import { createCoachInvite, type InviteResult } from "@/lib/admin/actions";

/**
 * 產生教練邀請碼。取代 `npx tsx scripts/invite-coach.ts`（腳本留著當逃生口）。
 *
 * 這裡只產 CoachInvite（發給還不是教練的人）。學員邀請碼不進後台——
 * 那個連結必須由教練用他自己的官方帳號傳給學員（SPEC.md §3.2）。
 */
export default function InviteForm() {
  const [result, action, pending] = useActionState<InviteResult | null, FormData>(
    createCoachInvite,
    null,
  );

  return (
    <div className="px-5 py-4">
      <form action={action} className="flex flex-wrap items-end gap-3">
        <label className="min-w-48 flex-1">
          <span className="text-xs font-medium text-slate-600">教練名稱</span>
          <input
            name="label"
            required
            maxLength={50}
            placeholder="王教練"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </label>

        <label className="w-32">
          <span className="text-xs font-medium text-slate-600">有效天數</span>
          <input
            name="days"
            type="number"
            min={1}
            max={90}
            defaultValue={14}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm tabular-nums outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </label>

        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:bg-slate-300"
        >
          {pending ? "產生中…" : "產生邀請連結"}
        </button>
      </form>

      {result?.ok === false ? (
        <p className="mt-3 text-sm text-rose-600">{result.error}</p>
      ) : null}

      {result?.ok ? (
        <div className="mt-4 rounded-md border border-teal-200 bg-teal-50/60 p-4">
          <p className="text-xs font-medium text-teal-800">
            給「{result.label}」的邀請連結（一次性，過期或使用後失效）
          </p>
          {/* 這串要貼到 LINE 給教練，所以永遠可以直接選取複製，不藏在按鈕後面。 */}
          <code className="mt-2 block rounded border border-teal-200 bg-white px-3 py-2 text-xs break-all select-all">
            {result.url}
          </code>
        </div>
      ) : null}
    </div>
  );
}
