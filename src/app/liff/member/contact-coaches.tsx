"use client";

import { useEffect, useState } from "react";
import { api } from "../api";
import { Card, ErrorBox, Hint, Screen, Title } from "../ui";

type CoachRow = { id: string; name: string; oaUrl: string };

/**
 * 聯絡教練。Rich Menu 是全體共用的，無法寫死單一教練的官方帳號網址——
 * 學員可能同時屬於多位教練，因此在這裡動態列出（SPEC.md §7）。
 */
export default function ContactCoaches({ idToken }: { idToken: string }) {
  const [coaches, setCoaches] = useState<CoachRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ coaches: CoachRow[] }>("/api/member/coaches", idToken)
      .then((d) => {
        if (!cancelled) setCoaches(d.coaches);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [idToken]);

  if (error) {
    return (
      <Screen>
        <ErrorBox>{error}</ErrorBox>
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>聯絡教練</Title>
      <Hint>
        課表查詢與請假在這個帳號操作，其他事情請直接跟教練的官方帳號聯絡。
      </Hint>

      <div className="mt-5 space-y-3">
        {coaches === null ? (
          <Hint>載入中…</Hint>
        ) : coaches.length === 0 ? (
          <Hint>目前沒有連結的教練。</Hint>
        ) : (
          coaches.map((c) => (
            <Card key={c.id}>
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-slate-900">{c.name} 教練</span>
                <a
                  href={c.oaUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 rounded-full bg-[#06C755] px-4 py-2 text-sm font-semibold text-white"
                >
                  前往聊天
                </a>
              </div>
            </Card>
          ))
        )}
      </div>
    </Screen>
  );
}
