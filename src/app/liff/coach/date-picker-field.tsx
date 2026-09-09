"use client";

import { useState } from "react";
import ScheduleCalendar from "./schedule-calendar";
import { fmt, weekdayZh, ymd } from "@/lib/time";

/**
 * 上課日期選擇。刻意不用原生 date input：
 * 那個看不到既有課表，教練很容易排到已經滿的那天。
 */
export default function DatePickerField({
  idToken,
  value,
  onChange,
}: {
  idToken: string;
  value: string;
  onChange: (date: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  // 課程不能排到過去。
  const today = ymd(new Date());

  const shown = new Date(`${value}T00:00:00Z`);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setDraft(value);
          setOpen(true);
        }}
        className="block w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-base text-slate-900"
      >
        {fmt(shown, "yyyy 年 M 月 d 日")}（{weekdayZh(shown)}）
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-sm text-slate-500"
            >
              取消
            </button>
            <span className="text-base font-semibold text-slate-900">選擇上課日期</span>
            <button
              type="button"
              onClick={() => {
                onChange(draft);
                setOpen(false);
              }}
              className="text-sm font-semibold text-[#06C755]"
            >
              確定
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4">
            <ScheduleCalendar
              idToken={idToken}
              selected={draft}
              onSelect={setDraft}
              minDate={today}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
