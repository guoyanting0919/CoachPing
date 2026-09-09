"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { SessionRow } from "./day-view";
import { fmt, ymd } from "@/lib/time";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAY_HEADS = ["一", "二", "三", "四", "五", "六", "日"];

function monthGrid(anchor: string): string[] {
  const [y, m] = anchor.split("-").map(Number);
  const first = Date.UTC(y, m - 1, 1);
  const last = Date.UTC(y, m, 0);

  // 以星期一為首補滿前後空白，讓格子永遠是 7 的倍數。
  const leading = (new Date(first).getUTCDay() + 6) % 7;
  const trailing = 6 - ((new Date(last).getUTCDay() + 6) % 7);

  const start = first - leading * DAY_MS;
  const total = leading + new Date(last).getUTCDate() + trailing;

  return Array.from({ length: total }, (_, i) =>
    new Date(start + i * DAY_MS).toISOString().slice(0, 10),
  );
}

function shiftMonth(anchor: string, delta: number): string {
  const [y, m] = anchor.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7) + "-01";
}

/**
 * 月曆格。同時用於「目前排課狀況」總覽與「上課日期」選擇器——
 * 挑日期時看得到當天既有的課，才不會排到已經滿的那天。
 */
export default function ScheduleCalendar({
  idToken,
  selected,
  onSelect,
}: {
  idToken: string;
  selected: string | null;
  onSelect: (date: string) => void;
}) {
  const today = useMemo(() => ymd(new Date()), []);
  const [anchor, setAnchor] = useState(
    () => (selected ?? today).slice(0, 7) + "-01",
  );
  const [loaded, setLoaded] = useState<{ key: string; rows: SessionRow[] } | null>(null);

  const days = useMemo(() => monthGrid(anchor), [anchor]);
  const rangeKey = `${days[0]}~${days[days.length - 1]}`;
  const sessions = loaded?.key === rangeKey ? loaded.rows : null;

  useEffect(() => {
    let cancelled = false;

    api<{ sessions: SessionRow[] }>(
      `/api/coach/sessions?from=${days[0]}&to=${days[days.length - 1]}`,
      idToken,
    )
      .then((d) => {
        if (!cancelled) setLoaded({ key: rangeKey, rows: d.sessions });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [idToken, days, rangeKey]);

  const byDay = useMemo(() => {
    const map = new Map<string, SessionRow[]>();
    for (const s of sessions ?? []) {
      if (s.status !== "scheduled") continue;
      const key = ymd(new Date(s.startAt));
      map.set(key, [...(map.get(key) ?? []), s]);
    }
    return map;
  }, [sessions]);

  const month = anchor.slice(0, 7);
  const daySessions = selected ? (byDay.get(selected) ?? []) : [];

  return (
    <div>
      <div className="mb-2 flex items-center justify-between px-1">
        <NavBtn onClick={() => setAnchor(shiftMonth(anchor, -1))}>‹</NavBtn>
        <span className="text-sm font-medium text-slate-700">
          {month.slice(0, 4)} 年 {Number(month.slice(5))} 月
        </span>
        <NavBtn onClick={() => setAnchor(shiftMonth(anchor, 1))}>›</NavBtn>
      </div>

      <div className="grid grid-cols-7 gap-y-1">
        {WEEKDAY_HEADS.map((w) => (
          <div key={w} className="pb-1 text-center text-[10px] text-slate-400">
            {w}
          </div>
        ))}

        {days.map((d) => {
          const inMonth = d.slice(0, 7) === month;
          const count = byDay.get(d)?.length ?? 0;
          const isToday = d === today;
          const isSelected = d === selected;

          return (
            <button
              key={d}
              type="button"
              onClick={() => onSelect(d)}
              className={`flex h-10 flex-col items-center justify-center rounded-lg ${
                isSelected ? "bg-[#06C755] text-white" : ""
              }`}
            >
              <span
                className={`text-sm ${
                  isSelected
                    ? "font-semibold"
                    : !inMonth
                      ? "text-slate-300"
                      : isToday
                        ? "font-bold text-[#06C755]"
                        : "text-slate-700"
                }`}
              >
                {Number(d.slice(8))}
              </span>
              <span
                className={`mt-0.5 h-1 w-1 rounded-full ${
                  count > 0
                    ? isSelected
                      ? "bg-white"
                      : "bg-[#06C755]"
                    : "bg-transparent"
                }`}
              />
            </button>
          );
        })}
      </div>

      {selected ? (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <p className="mb-1 text-xs font-medium text-slate-500">
            {Number(selected.slice(5))}/{Number(selected.slice(8))} 這天的課
          </p>
          {daySessions.length === 0 ? (
            <p className="text-xs text-slate-400">沒有課</p>
          ) : (
            <ul className="space-y-1">
              {daySessions.map((s) => (
                <li key={s.id} className="flex gap-2 text-xs text-slate-600">
                  <span className="font-medium text-slate-900">
                    {fmt(new Date(s.startAt), "HH:mm")}
                  </span>
                  <span className="truncate">
                    {s.participants.map((p) => p.name).join("、")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function NavBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="px-3 py-1 text-lg text-slate-500">
      {children}
    </button>
  );
}
