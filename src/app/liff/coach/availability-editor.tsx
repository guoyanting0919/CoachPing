"use client";

import { useState } from "react";
import { Chip, Field, HalfHourSelect } from "../ui";
import {
  DEFAULT_SHARED,
  expandShared,
  hhmmToMin,
  minToHHMM,
  normalizeIntervals,
  toShared,
  type Interval,
  type SharedSetting,
} from "@/lib/booking";

/**
 * 可預約時段編輯（SPEC.md §3.1、§3.6）。
 *
 * 共用版是主入口（勾星期 + 一組起迄 + 休息），逐日的「個別調整」收在後面——
 * 「週三我只有晚上」是真實需求，但它不該是每位教練第一眼看到的形狀。
 * 註冊表單以 sharedOnly 只顯示共用版：那是第一個畫面，塞一個七列編輯器會讓人直接關掉。
 */

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
/** 顯示順序從週一起——台灣人講作息是從週一開始，週日排最後。 */
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export default function AvailabilityEditor({
  intervals,
  onChange,
  sharedOnly = false,
}: {
  intervals: Interval[];
  onChange: (next: Interval[]) => void;
  sharedOnly?: boolean;
}) {
  // 存下來的區間能用共用版表達就開共用版，否則直接展開個別調整——
  // 硬套共用版會把教練精心設定的逐日時段悄悄改掉。
  const [perDay, setPerDay] = useState(
    () => !sharedOnly && intervals.length > 0 && toShared(intervals) === null,
  );
  const [shared, setShared] = useState<SharedSetting>(
    () => toShared(intervals) ?? DEFAULT_SHARED,
  );

  function updateShared(next: SharedSetting) {
    setShared(next);
    onChange(expandShared(next));
  }

  if (perDay) {
    return (
      <PerDayEditor
        intervals={intervals}
        onChange={onChange}
        onBackToShared={() => {
          setPerDay(false);
          updateShared(shared);
        }}
      />
    );
  }

  const hasBreak = shared.breakStartMin !== null && shared.breakEndMin !== null;

  return (
    <div className="space-y-4">
      <Field label="哪幾天可以上課">
        <div className="flex flex-wrap gap-2">
          {WEEKDAY_ORDER.map((w) => (
            <Chip
              key={w}
              active={shared.weekdays.includes(w)}
              onClick={() =>
                updateShared({
                  ...shared,
                  weekdays: shared.weekdays.includes(w)
                    ? shared.weekdays.filter((x) => x !== w)
                    : [...shared.weekdays, w].sort((a, b) => a - b),
                })
              }
            >
              {WEEKDAYS[w]}
            </Chip>
          ))}
        </div>
      </Field>

      <Field label="可上課時間">
        <TimeRange
          startMin={shared.startMin}
          endMin={shared.endMin}
          onChange={(startMin, endMin) => updateShared({ ...shared, startMin, endMin })}
        />
      </Field>

      <div>
        <label className="flex items-center gap-2.5">
          <input
            type="checkbox"
            checked={hasBreak}
            onChange={(e) =>
              updateShared({
                ...shared,
                breakStartMin: e.target.checked ? DEFAULT_SHARED.breakStartMin : null,
                breakEndMin: e.target.checked ? DEFAULT_SHARED.breakEndMin : null,
              })
            }
            className="size-5 accent-[#06C755]"
          />
          <span className="text-sm font-medium text-slate-700">中間有休息時間</span>
        </label>

        {hasBreak ? (
          <div className="mt-2">
            <TimeRange
              startMin={shared.breakStartMin!}
              endMin={shared.breakEndMin!}
              onChange={(breakStartMin, breakEndMin) =>
                updateShared({ ...shared, breakStartMin, breakEndMin })
              }
            />
          </div>
        ) : null}
      </div>

      <Summary intervals={intervals} />

      {sharedOnly ? null : (
        <button
          type="button"
          onClick={() => setPerDay(true)}
          className="text-sm font-medium text-[#06C755]"
        >
          各天時間不一樣？個別調整 →
        </button>
      )}
    </div>
  );
}

/** 逐日編輯。每天可有多段，休息時間就是兩段之間的空隙（SPEC.md §4）。 */
function PerDayEditor({
  intervals,
  onChange,
  onBackToShared,
}: {
  intervals: Interval[];
  onChange: (next: Interval[]) => void;
  onBackToShared: () => void;
}) {
  function replaceDay(weekday: number, dayIntervals: Interval[]) {
    onChange([...intervals.filter((iv) => iv.weekday !== weekday), ...dayIntervals]);
  }

  return (
    <div className="space-y-3">
      {WEEKDAY_ORDER.map((weekday) => {
        const day = intervals
          .filter((iv) => iv.weekday === weekday)
          .sort((a, b) => a.startMin - b.startMin);

        return (
          <div key={weekday} className="rounded-xl bg-white p-3 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-700">
                週{WEEKDAYS[weekday]}
              </span>
              <button
                type="button"
                onClick={() =>
                  replaceDay(weekday, [
                    ...day,
                    // 接在最後一段之後，預設 1 小時；空的一天從 09:00 起。
                    {
                      weekday,
                      startMin: day.length ? Math.min(day[day.length - 1].endMin + 60, 22 * 60) : 9 * 60,
                      endMin: day.length ? Math.min(day[day.length - 1].endMin + 120, 23 * 60) : 12 * 60,
                    },
                  ])
                }
                className="text-xs font-medium text-[#06C755]"
              >
                ＋ 加一段
              </button>
            </div>

            {day.length === 0 ? (
              <p className="mt-1.5 text-xs text-slate-400">這天不開放預約</p>
            ) : (
              <div className="mt-2 space-y-2">
                {day.map((iv, i) => (
                  <div key={`${iv.startMin}-${i}`} className="flex min-w-0 items-center gap-2">
                    <TimeRange
                      startMin={iv.startMin}
                      endMin={iv.endMin}
                      onChange={(startMin, endMin) =>
                        replaceDay(
                          weekday,
                          day.map((x, j) => (j === i ? { weekday, startMin, endMin } : x)),
                        )
                      }
                    />
                    <button
                      type="button"
                      onClick={() =>
                        replaceDay(
                          weekday,
                          day.filter((_, j) => j !== i),
                        )
                      }
                      className="shrink-0 px-1 text-lg leading-none text-slate-300"
                      aria-label="刪除這段"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <button
        type="button"
        onClick={onBackToShared}
        className="text-sm font-medium text-slate-500"
      >
        ← 回到簡易設定（會套用同一組時間到選取的每一天）
      </button>
    </div>
  );
}

function TimeRange({
  startMin,
  endMin,
  onChange,
}: {
  startMin: number;
  endMin: number;
  onChange: (startMin: number, endMin: number) => void;
}) {
  // min-w-0 讓兩個下拉在窄螢幕上各自收縮，不撐出橫向捲軸。
  return (
    <div className="flex min-w-0 items-center gap-2">
      <HalfHourSelect
        value={minToHHMM(startMin)}
        onChange={(v) => {
          const min = hhmmToMin(v);
          if (min === null) return;
          // 起點推過終點時把終點一起往後推，不讓使用者停在一個不合法的中間狀態。
          onChange(min, Math.max(endMin, min + 30));
        }}
      />
      <span className="shrink-0 text-slate-400">–</span>
      <HalfHourSelect
        endOfDay
        value={minToHHMM(endMin)}
        onChange={(v) => {
          const min = hhmmToMin(v);
          if (min === null) return;
          onChange(Math.min(startMin, min - 30), min);
        }}
      />
    </div>
  );
}

/**
 * 把實際會存下去的區間攤出來給教練看。
 * 共用版隱藏了「休息把一天切成兩段」這件事，不顯示的話他無法確認自己設對了。
 */
function Summary({ intervals }: { intervals: Interval[] }) {
  const normalized = normalizeIntervals(intervals);

  if (normalized.length === 0) {
    return (
      <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
        目前沒有任何可預約時段，學員無法預約。
      </p>
    );
  }

  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-slate-600">
      {WEEKDAY_ORDER.filter((w) => normalized.some((iv) => iv.weekday === w)).map((w) => (
        <div key={w}>
          週{WEEKDAYS[w]}　
          {normalized
            .filter((iv) => iv.weekday === w)
            .sort((a, b) => a.startMin - b.startMin)
            .map((iv) => `${minToHHMM(iv.startMin)}–${minToHHMM(iv.endMin)}`)
            .join("、")}
        </div>
      ))}
    </div>
  );
}
