"use client";

import { useState } from "react";
import type { EndedRow, MemberRow } from "./members-list";
import { Button, ErrorBox } from "../ui";

type Mode = "menu" | "end" | "restore" | "told-him";

type Props = { idToken: string; onChanged: () => void } & (
  | { member: MemberRow; ended?: undefined }
  | { ended: EndedRow; member?: undefined }
);

/**
 * 單一學員的操作：結束合作與恢復合作（SPEC.md §4）。
 *
 * 互動沿用 session-actions 的原地狀態機——教練在課表上已經熟這個手勢。
 * 不用 window.confirm：它裝不下「同時取消 N 堂課」那個勾選框。
 */
export default function MemberActions({ idToken, onChanged, ...target }: Props) {
  const row = target.member ?? target.ended;
  const isEnded = target.ended !== undefined;

  const [mode, setMode] = useState<Mode>("menu");
  const [cancelFuture, setCancelFuture] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const futureCount = target.member?.futureSessionCount ?? 0;

  async function call(body: unknown, onDone: () => void) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/coach/members/${row.id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `操作失敗（${res.status}）`);
        return;
      }
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (mode === "menu") {
    return (
      <div className="mt-4 border-t border-slate-100 pt-4">
        {isEnded ? (
          <SecondaryButton onClick={() => setMode("restore")}>恢復合作</SecondaryButton>
        ) : (
          <SecondaryButton danger onClick={() => setMode("end")}>
            結束合作
          </SecondaryButton>
        )}
      </div>
    );
  }

  if (mode === "restore") {
    return (
      <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
        <p className="text-sm text-slate-600">
          恢復後 {row.name} 可以再向你預約，你也可以再為他排課。
          當初取消的課不會自動回來。
          {!row.linked ? "他還沒加入 LINE，恢復時會產生一張新的邀請連結。" : null}
        </p>

        {error ? <ErrorBox>{error}</ErrorBox> : null}

        <div className="flex gap-2">
          <SecondaryButton onClick={() => setMode("menu")}>返回</SecondaryButton>
          <div className="flex-1">
            <Button
              disabled={busy}
              onClick={() => void call({ action: "restore" }, onChanged)}
            >
              {busy ? "處理中…" : "確認恢復合作"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // 未連結學員收不到取消通知，教練必須自己講（降級流程，SPEC.md §8）。
  if (mode === "told-him") {
    return (
      <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
        <div className="rounded-xl bg-amber-50 p-3">
          <p className="text-sm text-amber-800">
            已結束與 {row.name} 的合作。他沒有加入 LINE，系統送不出取消通知——記得自己告訴他。
          </p>
        </div>
        <Button onClick={onChanged}>知道了</Button>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
      <p className="text-sm text-slate-600">
        結束後 {row.name} 不能再向你預約，你也不能再為他排課。
        歷史記錄會保留，隨時可以恢復合作。
      </p>

      {futureCount > 0 ? (
        <button
          type="button"
          onClick={() => setCancelFuture(!cancelFuture)}
          className="flex w-full items-start gap-2.5 text-left"
        >
          <span
            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded ${
              cancelFuture ? "bg-red-600 text-white" : "ring-1 ring-slate-300"
            }`}
          >
            {cancelFuture ? "✓" : null}
          </span>
          <span className="text-sm text-slate-700">
            同時取消未來的 {futureCount} 堂課
            <span className="mt-0.5 block text-xs text-slate-400">
              {cancelFuture
                ? row.linked
                  ? "他會收到一則取消通知。"
                  : "他沒加入 LINE，收不到通知，要你自己告訴他。"
                : `那 ${futureCount} 堂課會照原定時間進行。`}
            </span>
          </span>
        </button>
      ) : null}

      {error ? <ErrorBox>{error}</ErrorBox> : null}

      <div className="flex gap-2">
        <SecondaryButton onClick={() => setMode("menu")}>返回</SecondaryButton>
        <button
          disabled={busy}
          onClick={() =>
            void call({ action: "end", cancelFutureSessions: cancelFuture }, () => {
              // 沒課可取消就沒東西要通知他，不必多攔一個畫面。
              if (!row.linked && cancelFuture && futureCount > 0) {
                setMode("told-him");
                return;
              }
              onChanged();
            })
          }
          className="flex-1 rounded-xl bg-red-600 px-4 py-3 text-base font-semibold text-white disabled:bg-slate-300"
        >
          {busy ? "處理中…" : "確認結束合作"}
        </button>
      </div>
    </div>
  );
}

function SecondaryButton({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-xl px-4 py-3 text-sm font-semibold ring-1 ${
        danger ? "text-red-600 ring-red-200" : "text-slate-600 ring-slate-200"
      }`}
    >
      {children}
    </button>
  );
}
