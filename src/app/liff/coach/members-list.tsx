"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { ErrorBox, Hint, Screen, Title } from "../ui";
import CopyableText from "../copyable-text";
import InviteMember from "./invite-member";
import MemberActions from "./member-actions";
import { fmt } from "@/lib/time";

export type MemberRow = {
  id: string;
  name: string;
  linked: boolean;
  blocked: boolean;
  inviteUrl: string | null;
  /** 未來已排定的課。結束合作的確認畫面要講出這個數字。 */
  futureSessionCount: number;
};

export type EndedRow = {
  id: string;
  name: string;
  linked: boolean;
  endedAt: string | null;
};

type ListResult = {
  members: MemberRow[];
  ended: EndedRow[];
  linkedCount: number;
  totalCount: number;
};

type Tab = "active" | "ended";

export default function MembersList({ idToken }: { idToken: string }) {
  // 邀請學員從 Rich Menu 移到這裡——邀請本來就是管理學員的子動作，
  // 而選單格數有限，留給每天都會用到的功能。
  const [inviting, setInviting] = useState(false);
  const [data, setData] = useState<ListResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("active");
  const [openId, setOpenId] = useState<string | null>(null);

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

  if (inviting) {
    return <InviteMember idToken={idToken} onBack={() => { setInviting(false); reload(); }} />;
  }

  function onChanged() {
    setOpenId(null);
    reload();
  }

  return (
    <Screen>
      <div className="flex items-center justify-between">
        <Title>我的學員</Title>
        <button
          onClick={() => setInviting(true)}
          className="rounded-full bg-[#06C755] px-4 py-2 text-sm font-semibold text-white"
        >
          ＋ 邀請
        </button>
      </div>

      {/* 已連結率是本產品的第一北極星指標，放在最顯眼處（SPEC.md §8、§13）。
          分母只算進行中的關係，否則結束過的舊帳會讓它永遠清不到 100%。 */}
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

      {/* 沒結束過任何人就不顯示分頁——多數教練永遠看不到這一排。 */}
      {data.ended.length > 0 ? (
        <div className="mt-5 flex gap-2">
          <TabButton active={tab === "active"} onClick={() => { setTab("active"); setOpenId(null); }}>
            進行中（{data.members.length}）
          </TabButton>
          <TabButton active={tab === "ended"} onClick={() => { setTab("ended"); setOpenId(null); }}>
            已結束（{data.ended.length}）
          </TabButton>
        </div>
      ) : null}

      {tab === "active" ? (
        <div className="mt-5 space-y-3">
          {data.members.length === 0 ? (
            <Hint>還沒有學員。點上方的「＋ 邀請」開始。</Hint>
          ) : null}

          {data.members.map((m) => (
            <div key={m.id} className="rounded-2xl bg-white p-4 shadow-sm">
              <button
                onClick={() => setOpenId(openId === m.id ? null : m.id)}
                className="w-full text-left"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-slate-900">{m.name}</span>
                  <StatusBadge linked={m.linked} blocked={m.blocked} />
                </div>
              </button>

              {!m.linked ? (
                <div className="mt-3">
                  {m.inviteUrl ? (
                    <CopyableText
                      text={m.inviteUrl}
                      buttonLabel="複製邀請連結"
                      shareText={`這是你的專屬加入連結，點開填一下名字就完成了：\n${m.inviteUrl}`}
                    />
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

              {openId === m.id ? (
                <MemberActions member={m} idToken={idToken} onChanged={onChanged} />
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          {data.ended.map((m) => (
            <div key={m.id} className="rounded-2xl bg-white p-4 shadow-sm">
              <button
                onClick={() => setOpenId(openId === m.id ? null : m.id)}
                className="w-full text-left"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-slate-500">{m.name}</span>
                  {m.endedAt ? (
                    <span className="shrink-0 text-xs text-slate-400">
                      {fmt(new Date(m.endedAt), "yyyy/M/d")} 結束
                    </span>
                  ) : null}
                </div>
              </button>

              {openId === m.id ? (
                <MemberActions ended={m} idToken={idToken} onChanged={onChanged} />
              ) : null}
            </div>
          ))}
        </div>
      )}
    </Screen>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-1.5 text-sm font-medium ${
        active ? "bg-slate-900 text-white" : "bg-white text-slate-500 ring-1 ring-slate-200"
      }`}
    >
      {children}
    </button>
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
