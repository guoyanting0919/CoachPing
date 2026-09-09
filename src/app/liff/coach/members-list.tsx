"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { ErrorBox, Hint, Screen, Title } from "../ui";
import CopyableLink from "../copyable-link";

type MemberRow = {
  id: string;
  name: string;
  linked: boolean;
  blocked: boolean;
  inviteUrl: string | null;
};

type ListResult = { members: MemberRow[]; linkedCount: number; totalCount: number };

export default function MembersList({ idToken }: { idToken: string }) {
  const [data, setData] = useState<ListResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;

    api<ListResult>("/api/coach/members", idToken)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError((err as Error).message);
      });

    return () => {
      cancelled = true;
    };
  }, [idToken, attempt]);

  async function reinvite(memberId: string) {
    try {
      await api(`/api/coach/members/${memberId}/reinvite`, idToken, { method: "POST" });
      reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (error) {
    return (
      <Screen>
        <ErrorBox>{error}</ErrorBox>
      </Screen>
    );
  }

  if (!data) return <Screen>載入中…</Screen>;

  const unlinked = data.totalCount - data.linkedCount;

  return (
    <Screen>
      <Title>我的學員</Title>

      {/* 已連結率是本產品的第一北極星指標，放在最顯眼處（SPEC.md §8、§13）。 */}
      <div className="mt-4 rounded-2xl bg-white p-5 shadow-sm">
        <div className="flex items-baseline gap-1.5">
          <span className="text-3xl font-bold text-slate-900">{data.linkedCount}</span>
          <span className="text-lg text-slate-400">／{data.totalCount}</span>
          <span className="ml-1 text-sm text-slate-500">位已連結 LINE</span>
        </div>
        {unlinked > 0 ? (
          <p className="mt-2 text-sm text-amber-700">
            還有 {unlinked} 位沒加入，他們收不到上課提醒，需要你手動通知。
          </p>
        ) : (
          <p className="mt-2 text-sm text-emerald-700">全部學員都能收到自動提醒。</p>
        )}
      </div>

      <div className="mt-5 space-y-3">
        {data.members.length === 0 ? (
          <Hint>還沒有學員。點下方選單的「邀請學員」開始。</Hint>
        ) : null}

        {data.members.map((m) => (
          <div key={m.id} className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium text-slate-900">{m.name}</span>
              <StatusBadge linked={m.linked} blocked={m.blocked} />
            </div>

            {!m.linked ? (
              <div className="mt-3">
                {m.inviteUrl ? (
                  <CopyableLink url={m.inviteUrl} />
                ) : (
                  <button
                    onClick={() => void reinvite(m.id)}
                    className="text-sm font-medium text-[#06C755] underline"
                  >
                    邀請連結已過期，重新產生
                  </button>
                )}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </Screen>
  );
}

function StatusBadge({ linked, blocked }: { linked: boolean; blocked: boolean }) {
  // 封鎖比未連結更危險：教練會誤以為學員收到了通知，實際上沒有。
  if (blocked) {
    return <Badge className="bg-red-50 text-red-700">已封鎖</Badge>;
  }
  if (linked) {
    return <Badge className="bg-emerald-50 text-emerald-700">已連結</Badge>;
  }
  return <Badge className="bg-amber-50 text-amber-700">未加入</Badge>;
}

function Badge({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${className}`}>
      {children}
    </span>
  );
}
