"use client";

import { useState } from "react";
import type { SessionRow } from "./day-view";
import { Button, ErrorBox } from "../ui";
import { fmt, ymd } from "@/lib/time";

type Mode = "menu" | "reschedule" | "cancel";
type Scope = "single" | "future";

/** 單堂課的操作：改期與取消。重複課程可選擇只動這堂或連同之後的。 */
export default function SessionActions({
  session,
  idToken,
  onChanged,
}: {
  session: SessionRow;
  idToken: string;
  onChanged: () => void;
}) {
  const start = new Date(session.startAt);
  const [mode, setMode] = useState<Mode>("menu");
  const [date, setDate] = useState(ymd(start));
  const [time, setTime] = useState(fmt(start, "HH:mm"));
  const [scope, setScope] = useState<Scope>("single");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSeries = session.seriesId !== null;

  async function call(method: "PATCH" | "DELETE", url: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${idToken}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `操作失敗（${res.status}）`);
        return;
      }
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (mode === "menu") {
    return (
      <div className="mt-4 flex gap-2 border-t border-slate-100 pt-4">
        <SecondaryButton onClick={() => setMode("reschedule")}>改期</SecondaryButton>
        <SecondaryButton danger onClick={() => setMode("cancel")}>
          取消課程
        </SecondaryButton>
      </div>
    );
  }

  if (mode === "reschedule") {
    return (
      <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
        {/* 改整個系列時只換時間、不換日期——教練說「以後都改成 20:00」
            是這個意思，而不是把整串課往後推。 */}
        {scope === "single" ? (
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-4 py-3 text-base"
          />
        ) : null}

        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          className="w-full rounded-xl border border-slate-200 px-4 py-3 text-base"
        />

        {isSeries ? (
          <ScopePicker
            scope={scope}
            onChange={setScope}
            futureLabel="這堂及之後每一堂（只改時間，日期不變）"
          />
        ) : null}

        {error ? <ErrorBox>{error}</ErrorBox> : null}

        <div className="flex gap-2">
          <SecondaryButton onClick={() => setMode("menu")}>返回</SecondaryButton>
          <div className="flex-1">
            <Button
              disabled={busy}
              onClick={() =>
                void call("PATCH", `/api/coach/sessions/${session.id}`, {
                  scope,
                  ...(scope === "single" ? { date } : {}),
                  time,
                })
              }
            >
              {busy ? "儲存中…" : "確認改期"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
      <p className="text-sm text-slate-600">取消後學員會收到通知，課程記錄會保留。</p>

      {isSeries ? (
        <ScopePicker scope={scope} onChange={setScope} futureLabel="這堂及之後每一堂" />
      ) : null}

      {error ? <ErrorBox>{error}</ErrorBox> : null}

      <div className="flex gap-2">
        <SecondaryButton onClick={() => setMode("menu")}>返回</SecondaryButton>
        <button
          disabled={busy}
          onClick={() =>
            void call("DELETE", `/api/coach/sessions/${session.id}?scope=${scope}`)
          }
          className="flex-1 rounded-xl bg-red-600 px-4 py-3 text-base font-semibold text-white disabled:bg-slate-300"
        >
          {busy ? "取消中…" : "確認取消"}
        </button>
      </div>
    </div>
  );
}

function ScopePicker({
  scope,
  onChange,
  futureLabel,
}: {
  scope: Scope;
  onChange: (s: Scope) => void;
  futureLabel: string;
}) {
  return (
    <div className="space-y-1.5">
      <RadioRow checked={scope === "single"} onClick={() => onChange("single")}>
        只有這一堂
      </RadioRow>
      <RadioRow checked={scope === "future"} onClick={() => onChange("future")}>
        {futureLabel}
      </RadioRow>
    </div>
  );
}

function RadioRow({
  checked,
  onClick,
  children,
}: {
  checked: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm ${
        checked ? "bg-[#06C755]/10 text-slate-900" : "text-slate-600"
      }`}
    >
      <span
        className={`h-4 w-4 shrink-0 rounded-full border-2 ${
          checked ? "border-[#06C755] bg-[#06C755]" : "border-slate-300"
        }`}
      />
      {children}
    </button>
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
