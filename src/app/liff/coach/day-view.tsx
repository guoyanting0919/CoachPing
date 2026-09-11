"use client";

import { useMemo, useState } from "react";
import ScheduleCalendar from "./schedule-calendar";
import SessionActions from "./session-actions";
import { invalidateSessions } from "./session-cache";
import { Card, Hint, Screen, Title } from "../ui";
import { fmt, weekdayZh, ymd } from "@/lib/time";

export type SessionRow = {
  id: string;
  seriesId: string | null;
  startAt: string;
  durationMin: number;
  location: string | null;
  status: "scheduled" | "cancelled" | "completed";
  origin: "coach_scheduled" | "member_booked";
  participants: { id: string; name: string; linked: boolean }[];
};

/** 教練的課表。以月為單位——一週的視野看不出下個月的排課密度。 */
export default function DayView({ idToken }: { idToken: string }) {
  const today = useMemo(() => ymd(new Date()), []);
  const [selected, setSelected] = useState(today);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <Screen>
      <Title>我的課表</Title>

      <div className="mt-4 rounded-2xl bg-white p-3 shadow-sm">
        <ScheduleCalendar
          idToken={idToken}
          selected={selected}
          onSelect={(d) => {
            setSelected(d);
            setOpenId(null);
          }}
          renderDayDetail={(date, sessions) => (
            <DayDetail
              date={date}
              sessions={sessions}
              idToken={idToken}
              openId={openId}
              onToggle={(id) => setOpenId(openId === id ? null : id)}
              onChanged={() => {
                setOpenId(null);
                invalidateSessions();
              }}
            />
          )}
        />
      </div>
    </Screen>
  );
}

function DayDetail({
  date,
  sessions,
  idToken,
  openId,
  onToggle,
  onChanged,
}: {
  date: string;
  sessions: SessionRow[];
  idToken: string;
  openId: string | null;
  onToggle: (id: string) => void;
  onChanged: () => void;
}) {
  const d = new Date(`${date}T00:00:00Z`);

  return (
    <div className="border-t border-slate-100 pt-4">
      <p className="mb-2 text-sm font-semibold text-slate-700">
        {fmt(d, "M/d")}（{weekdayZh(d)}）
      </p>

      {sessions.length === 0 ? (
        <Hint>這天沒有課。</Hint>
      ) : (
        <div className="space-y-3">
          {sessions.map((s) => (
            <SessionCard
              key={s.id}
              session={s}
              idToken={idToken}
              open={openId === s.id}
              onToggle={() => onToggle(s.id)}
              onChanged={onChanged}
            />
          ))}
        </div>
      )}
    </div>
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
          {/*
            「學員預約」優先於「重複課程」顯示，而且預約來的課不可能有 seriesId
            （學員一次只能約一堂，SPEC.md §3.6）所以兩者不會競爭。
            這個標記是教練看到一堂自己沒印象排的課時唯一能得到的答案（ADR-0002）。
          */}
          {cancelled ? (
            <Badge className="bg-slate-100 text-slate-500">已取消</Badge>
          ) : session.origin === "member_booked" ? (
            <Badge className="bg-emerald-50 text-emerald-700">學員預約</Badge>
          ) : session.seriesId ? (
            <Badge className="bg-slate-100 text-slate-500">重複課程</Badge>
          ) : null}
        </div>

        <p className={`mt-1 text-sm ${cancelled ? "text-slate-400" : "text-slate-700"}`}>
          {session.participants.map((p) => p.name).join("、") || "（無學員）"}
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

function Badge({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${className}`}>
      {children}
    </span>
  );
}
