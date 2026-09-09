"use client";

import { useEffect, useMemo, useState } from "react";
import type { SessionRow } from "./day-view";
import { fetchRange, peekRange, subscribeInvalidate } from "./session-cache";
import { monthAnchor, monthGrid, shiftMonth } from "@/lib/calendar";
import { fmtMonthDay, fmtTimeRange, ymd } from "@/lib/time";

const WEEKDAY_HEADS = ["一", "二", "三", "四", "五", "六", "日"];

/**
 * 月曆格。同時用於「目前排課狀況」總覽與「上課日期」選擇器——
 * 挑日期時看得到當天既有的課，才不會排到已經滿的那天。
 */
export default function ScheduleCalendar({
  idToken,
  selected,
  onSelect,
  /** 早於此日期的格子不可選。選日期時傳今天；純瀏覽時不傳。 */
  minDate,
}: {
  idToken: string;
  selected: string | null;
  onSelect: (date: string) => void;
  minDate?: string;
}) {
  const today = useMemo(() => ymd(new Date()), []);
  const [anchor, setAnchor] = useState(() => monthAnchor(selected ?? today));
  const days = useMemo(() => monthGrid(anchor), [anchor]);
  const from = days[0];
  const to = days[days.length - 1];
  const rangeKey = `${from}~${to}`;

  // 初始值直接讀快取：頁面載入時已在背景預抓，多數情況下這裡就有資料，
  // 不需要 loading 態。沒命中時先渲染沒有標記的月曆，資料到了再補上。
  const [loaded, setLoaded] = useState<{ key: string; rows: SessionRow[] } | null>(() => {
    const hit = peekRange(from, to);
    return hit ? { key: rangeKey, rows: hit } : null;
  });
  const sessions = loaded?.key === rangeKey ? loaded.rows : null;

  // 別處改動課程後清掉本地副本，下面的 effect 會重抓。
  useEffect(() => subscribeInvalidate(() => setLoaded(null)), []);

  useEffect(() => {
    if (sessions) return;
    let cancelled = false;

    fetchRange(idToken, from, to)
      .then((rows) => {
        if (!cancelled) setLoaded({ key: rangeKey, rows });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [idToken, from, to, rangeKey, sessions]);

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
          const disabled = minDate !== undefined && d < minDate;

          return (
            <button
              key={d}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(d)}
              className={`flex h-10 flex-col items-center justify-center rounded-lg ${
                isSelected ? "bg-[#06C755] text-white" : ""
              } ${disabled ? "cursor-not-allowed" : ""}`}
            >
              <span
                className={`text-sm ${
                  isSelected
                    ? "font-semibold"
                    : disabled
                      ? "text-slate-200 line-through"
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
            {fmtMonthDay(selected)} 這天的課
          </p>
          {daySessions.length === 0 ? (
            <p className="text-xs text-slate-400">沒有課</p>
          ) : (
            <ul className="space-y-1">
              {daySessions.map((s) => (
                <li key={s.id} className="flex gap-2 text-xs text-slate-600">
                  {/* 顯示結束時間，教練才不用自己算課上到幾點。 */}
                  <span className="shrink-0 font-medium text-slate-900">
                    {fmtTimeRange(new Date(s.startAt), s.durationMin)}
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
