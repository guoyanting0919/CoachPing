"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import {
  Button,
  Card,
  Chip,
  ErrorBox,
  Hint,
  Screen,
  Section,
  Select,
  TextInput,
  Title,
} from "../ui";
import { DEFAULT_WEEKS, MAX_PARTICIPANTS, generateStartTimes } from "@/lib/schedule";
import { fmtSession, ymd } from "@/lib/time";

type MemberRow = { id: string; name: string; linked: boolean };
type ListResult = { members: MemberRow[] };

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

export default function ScheduleForm({ idToken }: { idToken: string }) {
  const [members, setMembers] = useState<MemberRow[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [time, setTime] = useState("19:00");
  const [duration, setDuration] = useState(60);
  const [weeks, setWeeks] = useState(DEFAULT_WEEKS);
  const [startDate, setStartDate] = useState(() => ymd(new Date()));
  const [location, setLocation] = useState("");

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
      return generateStartTimes({
        startDate,
        weekdays,
        time,
        weeks: weekdays.length === 0 ? 1 : weeks,
      });
    } catch {
      return null;
    }
  }, [startDate, weekdays, time, weeks]);

  function toggleMember(id: string) {
    setSelected((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length >= MAX_PARTICIPANTS
          ? prev
          : [...prev, id],
    );
  }

  function toggleWeekday(d: number) {
    setWeekdays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort(),
    );
  }

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
          weekdays,
          time,
          weeks,
          durationMin: duration,
          location: location.trim() || undefined,
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
        setError(data.error ?? `建立失敗（${res.status}）`);
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

      <div className="mt-5 space-y-6 pb-32">
        <Section
          title="學員"
          hint={`最多 ${MAX_PARTICIPANTS} 位。已選 ${selected.length} 位`}
        >
          <div className="flex flex-wrap gap-2">
            {members.map((m) => {
              const active = selected.includes(m.id);
              return (
                <Chip
                  key={m.id}
                  active={active}
                  disabled={!active && selected.length >= MAX_PARTICIPANTS}
                  onClick={() => toggleMember(m.id)}
                >
                  {m.name}
                  {m.linked ? "" : " ·未加入"}
                </Chip>
              );
            })}
          </div>
        </Section>

        <Section title="時間">
          <div className="flex gap-3">
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-base text-slate-900"
            />
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
        </Section>

        <Section title="重複" hint="不選任何一天就是單次課程">
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((label, d) => (
              <Chip key={d} active={weekdays.includes(d)} onClick={() => toggleWeekday(d)}>
                {label}
              </Chip>
            ))}
          </div>

          {weekdays.length > 0 ? (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-sm text-slate-600">持續</span>
              <Select value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
                {[4, 8, 12, 16, 26].map((w) => (
                  <option key={w} value={w}>
                    {w} 週
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
        </Section>

        <Section
          title={weekdays.length > 0 ? "從哪天開始" : "上課日期"}
        >
          <TextInput
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </Section>

        <Section title="地點" hint="選填">
          <TextInput
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="信義店"
            maxLength={100}
          />
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
          <p className="mb-2 text-center text-sm text-slate-600">
            {preview?.length
              ? `${fmtSession(preview[0])} 起，共 ${preview.length} 堂`
              : "請選擇日期"}
          </p>
          <Button onClick={() => void submit(false)} disabled={!canSubmit}>
            {submitting ? "建立中…" : "建立課程"}
          </Button>
        </div>
      </div>
    </Screen>
  );
}
