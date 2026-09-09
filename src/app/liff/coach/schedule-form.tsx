"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import DatePickerField from "./date-picker-field";
import MemberPicker from "./member-picker";
import MonthCalendar from "./month-calendar";
import {
  Button,
  Card,
  ErrorBox,
  Hint,
  Screen,
  Section,
  Select,
  TimeSelect,
  Title,
} from "../ui";
import {
  DEFAULT_WEEKS,
  MAX_PARTICIPANTS,
  WEEK_OPTIONS,
  generateStartTimes,
} from "@/lib/schedule";
import { fmt, fmtSession, weekdayZh, ymd } from "@/lib/time";

type MemberRow = { id: string; name: string; linked: boolean };
type ListResult = { members: MemberRow[] };

const ERROR_MESSAGES: Record<string, string> = {
  past_date: "不能把課排到今天之前。",
  member_not_found: "選到的學員不存在或已停用，請重新選擇。",
  invalid_body: "資料格式有誤，請確認後重試。",
};

export default function ScheduleForm({ idToken }: { idToken: string }) {
  const [members, setMembers] = useState<MemberRow[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [time, setTime] = useState("19:00");
  const [duration, setDuration] = useState(60);
  const [weeks, setWeeks] = useState(DEFAULT_WEEKS);
  const [startDate, setStartDate] = useState(() => ymd(new Date()));

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<string[] | null>(null);
  const [done, setDone] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<ListResult>("/api/coach/members", idToken)
      .then((d) => {
        if (!cancelled) setMembers(d.members);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [idToken]);

  // 預覽用的堂數與首堂時間。與後端共用同一份生成邏輯，避免兩邊算出不同結果。
  const preview = useMemo(() => {
    if (!startDate) return null;
    try {
      return generateStartTimes({ startDate, time, weeks });
    } catch {
      return null;
    }
  }, [startDate, time, weeks]);

  async function submit(force: boolean) {
    setSubmitting(true);
    setError(null);
    setConflicts(null);

    try {
      const res = await fetch("/api/coach/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          memberIds: selected,
          startDate,
          time,
          weeks,
          durationMin: duration,
          force,
        }),
      });

      if (res.status === 409) {
        const data = (await res.json()) as { conflicts: string[] };
        setConflicts(data.conflicts);
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(ERROR_MESSAGES[data.error ?? ""] ?? `建立失敗（${res.status}）`);
        return;
      }

      const data = (await res.json()) as { created: number };
      setDone(data.created);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (done !== null) {
    return (
      <Screen>
        <Title>已排定 {done} 堂課</Title>
        <Hint>學員會在上課前收到自動提醒。未連結 LINE 的學員需要你手動通知。</Hint>
        <div className="mt-6">
          <Button
            onClick={() => {
              setDone(null);
              setSelected([]);
            }}
          >
            再排一組
          </Button>
        </div>
      </Screen>
    );
  }

  if (!members) return <Screen>載入中…</Screen>;

  if (members.length === 0) {
    return (
      <Screen>
        <Title>排課</Title>
        <Hint>還沒有學員。請先用下方選單的「邀請學員」新增。</Hint>
      </Screen>
    );
  }

  const canSubmit = selected.length > 0 && !!startDate && !submitting;

  return (
    <Screen>
      <Title>排課</Title>

      <div className="mt-4">
        <MonthCalendar idToken={idToken} />
      </div>

      <div className="mt-6 space-y-6 pb-32">
        <Section title="學員" hint={`最多 ${MAX_PARTICIPANTS} 位`}>
          <MemberPicker
            members={members}
            selected={selected}
            onChange={setSelected}
            max={MAX_PARTICIPANTS}
          />
        </Section>

        <Section title="上課日期" hint="重複時的星期幾由這個日期決定">
          <DatePickerField idToken={idToken} value={startDate} onChange={setStartDate} />
        </Section>

        <Section title="時間">
          <div className="flex items-center gap-3">
            <TimeSelect value={time} onChange={setTime} />
            {/* 時長吃掉剩餘寬度，min-w-0 讓它可以收縮而不是去擠時間下拉。 */}
            <div className="min-w-0 flex-1">
              <Select
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
              >
                {[30, 45, 60, 75, 90, 120].map((m) => (
                  <option key={m} value={m}>
                    {m} 分
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </Section>

        <Section title="重複">
          <Select value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
            <option value={1}>單堂課程</option>
            {WEEK_OPTIONS.map((w) => (
              <option key={w} value={w}>
                連續 {w} 週
              </option>
            ))}
          </Select>
        </Section>

        {error ? <ErrorBox>{error}</ErrorBox> : null}

        {conflicts ? (
          <Card>
            <p className="text-sm font-semibold text-amber-800">
              以下 {conflicts.length} 個時段你已經有課
            </p>
            <ul className="mt-2 space-y-0.5 text-sm text-slate-600">
              {conflicts.slice(0, 5).map((c) => (
                <li key={c}>{fmtSession(new Date(c))}</li>
              ))}
              {conflicts.length > 5 ? <li>…其餘 {conflicts.length - 5} 堂</li> : null}
            </ul>
            <div className="mt-3">
              <Button onClick={() => void submit(true)} disabled={submitting}>
                仍要建立
              </Button>
            </div>
          </Card>
        ) : null}
      </div>

      {/* 預覽與送出固定在底部，滑到哪都按得到。 */}
      <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 p-4 backdrop-blur">
        <div className="mx-auto max-w-md">
          {/* 重複時列出每一堂的確切日期。只寫「x/x 起，共 N 堂」教練得自己心算，
              而排錯日期的代價是學員白跑一趟。 */}
          <div className="mb-2 text-center">
            {!preview?.length ? (
              <p className="text-sm text-slate-500">請選擇日期</p>
            ) : preview.length === 1 ? (
              <p className="text-sm text-slate-700">{fmtSession(preview[0])}・單堂</p>
            ) : (
              <>
                <p className="text-sm font-medium text-slate-800">
                  共 {preview.length} 堂・每週{weekdayZh(preview[0])} {time}
                </p>
                <p className="mt-1 max-h-14 overflow-y-auto text-xs leading-relaxed text-slate-500">
                  {preview.map((d) => fmt(d, "M/d")).join("、")}
                </p>
              </>
            )}
          </div>
          <Button onClick={() => void submit(false)} disabled={!canSubmit}>
            {submitting ? "建立中…" : "建立課程"}
          </Button>
        </div>
      </div>
    </Screen>
  );
}
