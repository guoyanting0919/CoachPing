"use client";

import { useState } from "react";
import type { SessionRow } from "./day-view";
import CopyableText from "../copyable-text";
import DatePickerField from "./date-picker-field";
import { Button, ErrorBox, TimeSelect } from "../ui";
import { fmt, fmtTimeRange, weekdayZh, ymd } from "@/lib/time";

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
        setError(
          data.error === "past_date"
            ? "不能把課改到今天之前。"
            : (data.error ?? `操作失敗（${res.status}）`),
        );
        return;
      }
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const unlinked = session.participants.filter((p) => !p.linked);

  if (mode === "menu") {
    return (
      <div className="mt-4 border-t border-slate-100 pt-4">
        <div className="flex gap-2">
          <SecondaryButton onClick={() => setMode("reschedule")}>改期</SecondaryButton>
          <SecondaryButton danger onClick={() => setMode("cancel")}>
            取消課程
          </SecondaryButton>
        </div>

        {/* 未連結 LINE 的學員收不到自動提醒，這裡把文字備好讓教練貼到
            自己的官方帳號傳給他——降級但不歸零（SPEC.md §8）。 */}
        {unlinked.length > 0 ? (
          <div className="mt-4 rounded-xl bg-amber-50 p-3">
            <p className="text-xs font-medium text-amber-800">
              {unlinked.map((p) => p.name).join("、")} 尚未加入，收不到自動提醒
            </p>
            <div className="mt-3 space-y-4">
              {unlinked.map((p) => (
                <CopyableText
                  key={p.id}
                  text={reminderTextFor(p.name, start, session.durationMin)}
                  buttonLabel={`複製給 ${p.name} 的提醒`}
                  shareText={reminderTextFor(p.name, start, session.durationMin)}
                  hint="貼到你自己的官方帳號傳給他"
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  if (mode === "reschedule") {
    return (
      <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
        {/* 改整個系列時只換時間、不換日期——教練說「以後都改成 20:00」
            是這個意思，而不是把整串課往後推。 */}
        {scope === "single" ? (
          <DatePickerField idToken={idToken} value={date} onChange={setDate} />
        ) : null}

        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-500">時間</span>
          <TimeSelect value={time} onChange={setTime} />
        </div>

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

function reminderTextFor(name: string, start: Date, durationMin: number): string {
  return `${name}你好，提醒你 ${fmt(start, "M/d")}（${weekdayZh(start)}）${fmtTimeRange(start, durationMin)} 有課。`;
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
