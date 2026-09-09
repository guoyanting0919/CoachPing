"use client";

import { useState } from "react";
import ScheduleCalendar from "./schedule-calendar";

/**
 * 可收合的月曆總覽。預設關閉，展開後才掛載 ScheduleCalendar——
 * 大多數時候教練是進來排課的，不該為了收合狀態的畫面多打一次 API。
 */
export default function MonthCalendar({ idToken }: { idToken: string }) {
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);

  return (
    <div className="rounded-2xl bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3"
      >
        <span className="text-sm font-semibold text-slate-700">目前排課狀況</span>
        <span className={`text-slate-400 transition ${open ? "rotate-180" : ""}`}>▾</span>
      </button>

      {open ? (
        <div className="border-t border-slate-100 px-3 pt-3 pb-4">
          <ScheduleCalendar
            idToken={idToken}
            selected={viewing}
            onSelect={(d) => setViewing(d === viewing ? null : d)}
          />
        </div>
      ) : null}
    </div>
  );
}
