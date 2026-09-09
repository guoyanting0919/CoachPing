"use client";

import { useEffect, useState } from "react";
import { api } from "../api";
import { Card, ErrorBox, Hint, Screen, Title } from "../ui";
import { fmt, fmtTimeRange, weekdayZh } from "@/lib/time";

type MemberSession = {
  id: string;
  startAt: string;
  durationMin: number;
  location: string | null;
  coachName: string;
  leavePending: boolean;
  leaveAutoApproves: boolean;
  leaveDeadlineHours: number;
};

const ERROR_MESSAGES: Record<string, string> = {
  session_not_found: "找不到這堂課，可能已被取消。",
  already_started: "這堂課已經開始了。",
  already_requested: "你已經送出過請假申請，教練還在確認中。",
};

export default function MemberSessions({ idToken }: { idToken: string }) {
  const [sessions, setSessions] = useState<MemberSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    api<{ sessions: MemberSession[] }>("/api/member/sessions", idToken)
      .then((d) => {
        if (!cancelled) setSessions(d.sessions);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError((err as Error).message);
      });

    return () => {
      cancelled = true;
    };
  }, [idToken, attempt]);

  if (error) {
    return (
      <Screen>
        <ErrorBox>{error}</ErrorBox>
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>我的課表</Title>

      <div className="mt-5 space-y-3">
        {sessions === null ? (
          <Hint>載入中…</Hint>
        ) : sessions.length === 0 ? (
          <Hint>目前沒有排定的課程。教練排課後就會出現在這裡，也會提前通知你。</Hint>
        ) : (
          sessions.map((s) => (
            <SessionCard
              key={s.id}
              session={s}
              idToken={idToken}
              open={openId === s.id}
              onToggle={() => setOpenId(openId === s.id ? null : s.id)}
              onDone={() => {
                setOpenId(null);
                setAttempt((n) => n + 1);
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
  onDone,
}: {
  session: MemberSession;
  idToken: string;
  open: boolean;
  onToggle: () => void;
  onDone: () => void;
}) {
  const start = new Date(session.startAt);

  return (
    <Card>
      <button onClick={onToggle} className="w-full text-left">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-base font-semibold text-slate-900">
            {fmt(start, "M/d")}（{weekdayZh(start)}）
          </span>
          {session.leavePending ? (
            <span className="shrink-0 rounded-full bg-amber-50 px-2.5 py-1 text-xs text-amber-700">
              請假待確認
            </span>
          ) : null}
        </div>

        <p className="mt-1 text-sm text-slate-700">
          {fmtTimeRange(start, session.durationMin)}　{session.coachName} 教練
        </p>

        {session.location ? (
          <p className="mt-0.5 text-xs text-slate-400">{session.location}</p>
        ) : null}
      </button>

      {open && !session.leavePending ? (
        <LeaveForm session={session} idToken={idToken} onDone={onDone} />
      ) : null}
    </Card>
  );
}

function LeaveForm({
  session,
  idToken,
  onDone,
}: {
  session: MemberSession;
  idToken: string;
  onDone: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/member/leave", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sessionId: session.id, reason: reason.trim() || undefined }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(ERROR_MESSAGES[data.error ?? ""] ?? `送出失敗（${res.status}）`);
        return;
      }
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!asking) {
    return (
      <div className="mt-4 border-t border-slate-100 pt-4">
        <button
          onClick={() => setAsking(true)}
          className="w-full rounded-xl px-4 py-3 text-sm font-semibold text-red-600 ring-1 ring-red-200"
        >
          我要請假
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
      {/* 送出前就講清楚後果：會直接完成，還是要等教練同意。 */}
      <p className="text-sm text-slate-600">
        {session.leaveAutoApproves
          ? "距離上課還有一段時間，送出後會直接完成請假，教練會收到通知。"
          : `距離上課不到 ${session.leaveDeadlineHours} 小時，需要教練同意。送出後教練會收到通知。`}
      </p>

      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="原因（選填）"
        maxLength={200}
        className="w-full rounded-xl border border-slate-200 px-4 py-3 text-base outline-none focus:border-[#06C755]"
      />

      {error ? <ErrorBox>{error}</ErrorBox> : null}

      <div className="flex gap-2">
        <button
          onClick={() => setAsking(false)}
          className="flex-1 rounded-xl px-4 py-3 text-sm font-semibold text-slate-600 ring-1 ring-slate-200"
        >
          取消
        </button>
        <button
          onClick={() => void submit()}
          disabled={busy}
          className="flex-1 rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white disabled:bg-slate-300"
        >
          {busy ? "送出中…" : "確認請假"}
        </button>
      </div>
    </div>
  );
}
