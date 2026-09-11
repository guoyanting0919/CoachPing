"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Button, ErrorBox, TimeSelect } from "../ui";
import { fmt, weekdayZh, ymd } from "@/lib/time";

/**
 * 封鎖時段（SPEC.md §3.7）。出國、受傷、國定假日、下午要去看醫生。
 * 只能收回、不能加開——教練想在非開放時段上課，直接排課即可。
 *
 * 日期用原生 input：和排課的日期選擇不同，這裡沒有「既有課表密度」要參考，
 * 自繪月曆換不到任何東西。
 */

type Block = { id: string; startAt: string; endAt: string; reason: string | null };

export default function BlocksEditor({ idToken }: { idToken: string }) {
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const today = ymd(new Date());
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [allDay, setAllDay] = useState(true);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("18:00");
  const [reason, setReason] = useState("");

  // 變更後的重載走這裡；首次載入則在 effect 內直接接 promise
  // （在 effect 本體同步呼叫會設 state 的函式會觸發 cascading render）。
  const load = useCallback(async () => {
    const d = await api<{ blocks: Block[] }>("/api/coach/blocks", idToken);
    setBlocks(d.blocks);
  }, [idToken]);

  useEffect(() => {
    let cancelled = false;

    api<{ blocks: Block[] }>("/api/coach/blocks", idToken)
      .then((d) => {
        if (!cancelled) setBlocks(d.blocks);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError((err as Error).message);
      });

    return () => {
      cancelled = true;
    };
  }, [idToken]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/coach/blocks", idToken, {
        method: "POST",
        body: {
          startDate,
          // 結束日早於開始日時視為單日，不讓使用者卡在錯誤訊息上。
          endDate: endDate < startDate ? startDate : endDate,
          allDay,
          startTime: allDay ? undefined : startTime,
          endTime: allDay ? undefined : endTime,
          reason: reason.trim() || undefined,
        },
      });
      setAdding(false);
      setReason("");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await api(`/api/coach/blocks/${id}`, idToken, { method: "DELETE" });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {blocks === null ? (
        <p className="text-xs text-slate-400">載入中…</p>
      ) : blocks.length === 0 ? (
        <p className="text-xs text-slate-400">目前沒有封鎖時段。</p>
      ) : (
        <ul className="space-y-2">
          {blocks.map((b) => (
            <li
              key={b.id}
              className="flex items-start justify-between gap-3 rounded-xl bg-white p-3 shadow-sm"
            >
              <div>
                <p className="text-sm text-slate-800">{describe(b)}</p>
                {b.reason ? (
                  <p className="mt-0.5 text-xs text-slate-400">{b.reason}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => void remove(b.id)}
                disabled={busy}
                className="shrink-0 text-xs text-slate-400"
              >
                解除
              </button>
            </li>
          ))}
        </ul>
      )}

      {error ? <ErrorBox>{error}</ErrorBox> : null}

      {adding ? (
        <div className="space-y-3 rounded-xl bg-white p-3 shadow-sm">
          <div className="flex items-center gap-2">
            <DateInput value={startDate} min={today} onChange={setStartDate} />
            <span className="shrink-0 text-slate-400">至</span>
            <DateInput value={endDate} min={startDate} onChange={setEndDate} />
          </div>

          <label className="flex items-center gap-2.5">
            <input
              type="checkbox"
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
              className="size-5 accent-[#06C755]"
            />
            <span className="text-sm font-medium text-slate-700">整天</span>
          </label>

          {allDay ? null : (
            <div className="flex items-center gap-2">
              <TimeSelect value={startTime} onChange={setStartTime} />
              <span className="shrink-0 text-slate-400">–</span>
              <TimeSelect value={endTime} onChange={setEndTime} />
            </div>
          )}

          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="原因（選填，只有你看得到）"
            maxLength={100}
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-[#06C755]"
          />

          <p className="text-xs text-slate-400">
            封鎖只讓學員之後約不到這段時間，
            <span className="font-semibold text-slate-500">不會</span>
            取消已經排定的課。
          </p>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="flex-1 rounded-xl bg-slate-100 py-2.5 text-sm font-medium text-slate-600"
            >
              取消
            </button>
            <div className="flex-1">
              <Button onClick={() => void submit()} disabled={busy}>
                {busy ? "儲存中…" : "封鎖"}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="text-sm font-medium text-[#06C755]"
        >
          ＋ 新增封鎖時段
        </button>
      )}
    </div>
  );
}

function DateInput({
  value,
  min,
  onChange,
}: {
  value: string;
  min: string;
  onChange: (v: string) => void;
}) {
  return (
    <input
      type="date"
      value={value}
      min={min}
      onChange={(e) => onChange(e.target.value)}
      className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-[#06C755]"
    />
  );
}

/** 「10/3（五）整天」或「10/3（五）14:00–17:00」，跨日則寫成範圍。 */
function describe(b: Block): string {
  const start = new Date(b.startAt);
  const end = new Date(b.endAt);
  const day = (d: Date) => `${fmt(d, "M/d")}（${weekdayZh(d)}）`;

  // 整天封鎖的 endAt 是「最後一天的次日 00:00」，顯示時要退回一天才不會多算。
  const isAllDay = fmt(start, "HH:mm") === "00:00" && fmt(end, "HH:mm") === "00:00";
  if (isAllDay) {
    const lastDay = new Date(end.getTime() - 24 * 60 * 60 * 1000);
    return ymd(start) === ymd(lastDay)
      ? `${day(start)}整天`
      : `${day(start)} – ${day(lastDay)}`;
  }

  return ymd(start) === ymd(end)
    ? `${day(start)}${fmt(start, "HH:mm")}–${fmt(end, "HH:mm")}`
    : `${day(start)}${fmt(start, "HH:mm")} – ${day(end)}${fmt(end, "HH:mm")}`;
}
