"use client";

import { useEffect, useState } from "react";
import { api } from "../api";
import { invalidateSessions } from "./session-cache";
import { Card, ErrorBox, Hint, Screen, Title } from "../ui";
import { fmt, fmtTimeRange, weekdayZh } from "@/lib/time";

type LeaveRow = {
  id: string;
  memberName: string;
  reason: string | null;
  startAt: string;
  durationMin: number;
  otherParticipants: number;
  started: boolean;
};

export default function LeaveReview({ idToken }: { idToken: string }) {
  const [leaves, setLeaves] = useState<LeaveRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api<{ leaves: LeaveRow[] }>("/api/coach/leaves", idToken)
      .then((d) => {
        if (!cancelled) setLeaves(d.leaves);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [idToken, attempt]);

  async function decide(id: string, decision: "approve" | "reject") {
    setBusyId(id);
    setError(null);
    try {
      await api(`/api/coach/leaves/${id}`, idToken, {
        method: "POST",
        body: { decision },
      });
      // 同意請假會改變課程參與者，課表快取要重抓。
      invalidateSessions();
      setAttempt((n) => n + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  if (error) {
    return (
      <Screen>
        <ErrorBox>{error}</ErrorBox>
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>請假通知</Title>
      <Hint>
        提前請假的會自動完成、不會出現在這裡。這裡只有臨時請假、需要你決定的。
      </Hint>

      <div className="mt-5 space-y-3">
        {leaves === null ? (
          <Hint>載入中…</Hint>
        ) : leaves.length === 0 ? (
          <Hint>目前沒有待處理的請假。</Hint>
        ) : (
          leaves.map((l) => {
            const start = new Date(l.startAt);
            const busy = busyId === l.id;

            return (
              <Card key={l.id}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-semibold text-slate-900">{l.memberName}</span>
                  {l.started ? (
                    <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-500">
                      已過上課時間
                    </span>
                  ) : null}
                </div>

                <p className="mt-1 text-sm text-slate-700">
                  {fmt(start, "M/d")}（{weekdayZh(start)}）
                  {fmtTimeRange(start, l.durationMin)}
                </p>

                {l.reason ? (
                  <p className="mt-1 text-sm text-slate-500">原因：{l.reason}</p>
                ) : null}

                {/* 同意後這堂課還上不上得成，是教練決定時最想知道的事。 */}
                <p className="mt-2 text-xs text-slate-400">
                  {l.otherParticipants > 0
                    ? `同堂還有 ${l.otherParticipants} 位學員，同意後課程照常。`
                    : "同意後這堂課會因無人參加而取消。"}
                </p>

                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => void decide(l.id, "reject")}
                    disabled={busy}
                    className="flex-1 rounded-xl px-4 py-3 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 disabled:opacity-50"
                  >
                    不同意
                  </button>
                  <button
                    onClick={() => void decide(l.id, "approve")}
                    disabled={busy}
                    className="flex-1 rounded-xl bg-[#06C755] px-4 py-3 text-sm font-semibold text-white disabled:bg-slate-300"
                  >
                    {busy ? "處理中…" : "同意請假"}
                  </button>
                </div>
              </Card>
            );
          })
        )}
      </div>
    </Screen>
  );
}
