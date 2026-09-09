"use client";

import { useEffect, useMemo, useState } from "react";
import SessionActions from "./session-actions";
import {
  fetchRange,
  invalidateSessions,
  peekRange,
  subscribeInvalidate,
} from "./session-cache";
import { Card, ErrorBox, Hint, Screen, Title } from "../ui";
import { weekOf, shiftWeek } from "@/lib/calendar";
import { fmt, weekdayZh, ymd } from "@/lib/time";

export type SessionRow = {
  id: string;
  seriesId: string | null;
  startAt: string;
  durationMin: number;
  location: string | null;
  status: "scheduled" | "cancelled" | "completed";
  participants: { id: string; name: string; linked: boolean }[];
};

export default function DayView({ idToken }: { idToken: string }) {
  const today = useMemo(() => ymd(new Date()), []);
  const [selected, setSelected] = useState(today);
  const [anchor, setAnchor] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const week = useMemo(() => weekOf(anchor), [anchor]);
  const weekKey = `${week[0]}~${week[6]}`;

  // 連同「這批資料屬於哪一週」一起存，切換週次時就不需要先同步清空狀態，
  // 也不會短暫顯示上一週的課。初始值讀快取，命中就不必等。
  const [loaded, setLoaded] = useState<{ weekKey: string; rows: SessionRow[] } | null>(
    () => {
      const hit = peekRange(week[0], week[6]);
      return hit ? { weekKey, rows: hit } : null;
    },
  );
  const sessions = loaded?.weekKey === weekKey ? loaded.rows : null;

  useEffect(() => subscribeInvalidate(() => setLoaded(null)), []);

  useEffect(() => {
    if (sessions) return;
    let cancelled = false;

    fetchRange(idToken, week[0], week[6])
      .then((rows) => {
        if (!cancelled) setLoaded({ weekKey, rows });
      })
      .catch((err: unknown) => {
        if (!cancelled) setError((err as Error).message);
      });

    return () => {
      cancelled = true;
    };
  }, [idToken, week, weekKey, sessions]);

  const byDay = useMemo(() => {
    const map = new Map<string, SessionRow[]>();
    for (const s of sessions ?? []) {
      const key = ymd(new Date(s.startAt));
      const list = map.get(key) ?? [];
      list.push(s);
      map.set(key, list);
    }
    return map;
  }, [sessions]);

  const daySessions = byDay.get(selected) ?? [];

  if (error) {
    return (
      <Screen>
        <ErrorBox>{error}</ErrorBox>
      </Screen>
    );
  }

  return (
    <Screen>
      <div className="flex items-center justify-between">
        <Title>課表</Title>
        <div className="flex gap-1">
          <NavButton onClick={() => setAnchor(shiftWeek(anchor, -1))}>‹</NavButton>
          <NavButton
            onClick={() => {
              setAnchor(today);
              setSelected(today);
            }}
          >
            今天
          </NavButton>
          <NavButton onClick={() => setAnchor(shiftWeek(anchor, 1))}>›</NavButton>
        </div>
      </div>

      {/* 一週七天橫排，有課的日子標點，一眼看出忙碌程度。 */}
      <div className="mt-4 grid grid-cols-7 gap-1">
        {week.map((d) => {
          const count = byDay.get(d)?.filter((s) => s.status === "scheduled").length ?? 0;
          const isSelected = d === selected;
          const isToday = d === today;
          const date = new Date(`${d}T00:00:00Z`);

          return (
            <button
              key={d}
              onClick={() => {
                setSelected(d);
                setOpenId(null);
              }}
              className={`flex flex-col items-center rounded-xl py-2 transition ${
                isSelected ? "bg-[#06C755] text-white" : "bg-white text-slate-700"
              }`}
            >
              <span className="text-[10px] opacity-70">{weekdayZh(date)}</span>
              <span
                className={`mt-0.5 text-sm font-semibold ${
                  isToday && !isSelected ? "text-[#06C755]" : ""
                }`}
              >
                {Number(d.slice(8))}
              </span>
              <span
                className={`mt-1 h-1 w-1 rounded-full ${
                  count > 0 ? (isSelected ? "bg-white" : "bg-[#06C755]") : "bg-transparent"
                }`}
              />
            </button>
          );
        })}
      </div>

      <div className="mt-6 space-y-3">
        {sessions === null ? (
          <Hint>載入中…</Hint>
        ) : daySessions.length === 0 ? (
          <Hint>這天沒有課。</Hint>
        ) : (
          daySessions.map((s) => (
            <SessionCard
              key={s.id}
              session={s}
              idToken={idToken}
              open={openId === s.id}
              onToggle={() => setOpenId(openId === s.id ? null : s.id)}
              onChanged={() => {
                setOpenId(null);
                invalidateSessions();
              }}
            />
          ))
        )}
      </div>
    </Screen>
  );
}

function SessionCard({
  session,
  idToken,
  open,
  onToggle,
  onChanged,
}: {
  session: SessionRow;
  idToken: string;
  open: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const start = new Date(session.startAt);
  const end = new Date(start.getTime() + session.durationMin * 60_000);
  const cancelled = session.status === "cancelled";

  return (
    <Card>
      <button onClick={onToggle} className="w-full text-left">
        <div className="flex items-baseline justify-between gap-3">
          <span
            className={`text-base font-semibold ${
              cancelled ? "text-slate-400 line-through" : "text-slate-900"
            }`}
          >
            {fmt(start, "HH:mm")}–{fmt(end, "HH:mm")}
          </span>
          {cancelled ? (
            <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-500">
              已取消
            </span>
          ) : session.seriesId ? (
            <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-500">
              重複課程
            </span>
          ) : null}
        </div>

        <p className={`mt-1 text-sm ${cancelled ? "text-slate-400" : "text-slate-700"}`}>
          {session.participants.map((p) => p.name).join("、")}
          {/* 未連結的學員收不到自動提醒，教練必須知道要手動通知。 */}
          {session.participants.some((p) => !p.linked) ? (
            <span className="ml-1 text-xs text-amber-700">（有學員未加入，需手動通知）</span>
          ) : null}
        </p>

        {session.location ? (
          <p className="mt-0.5 text-xs text-slate-400">{session.location}</p>
        ) : null}
      </button>

      {open && !cancelled ? (
        <SessionActions session={session} idToken={idToken} onChanged={onChanged} />
      ) : null}
    </Card>
  );
}

function NavButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-lg bg-white px-3 py-1.5 text-sm text-slate-600 ring-1 ring-slate-200"
    >
      {children}
    </button>
  );
}
