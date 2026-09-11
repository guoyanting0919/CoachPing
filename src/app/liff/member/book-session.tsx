"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Button, ErrorBox, Hint, Screen, Title } from "../ui";
import { fmt, fmtMonthDay, fmtTimeRange, weekdayZh } from "@/lib/time";

/**
 * 學員預約（SPEC.md §3.6）。
 *
 * 未來 30 天的垂直捲動清單，**只列有空位的日子**——學員心裡的問題是
 * 「最近什麼時候有空」，不是「10/23 有沒有空」。月曆會逼他一天一天點進去試。
 *
 * 格子只有「可約」一種狀態：不可約的時段根本不出現。
 * 不顯示為什麼不可約是隱私硬規則——學員不該從空檔的形狀推斷出
 * 教練其他學員的上課時間。
 */

type Selected = {
  coachId: string;
  coachName: string;
  durationMin: number;
  leadHours: number;
  remaining: number;
  maxOpenBookings: number;
  openBookings: number;
  horizonDays: number;
  days: { date: string; starts: string[] }[];
};

type Options = { coaches: { id: string; name: string }[]; selected: Selected | null };

const ERROR_MESSAGES: Record<string, string> = {
  slot_taken: "有時段剛被約走了，已更新可預約時間，請重新選擇。",
  too_many_bookings: "超過可預約的堂數上限，上完課之後才能再約。",
  slots_overlap: "選到互相重疊的時段了，請重新選擇。",
  coach_not_bookable: "這位教練目前不開放預約。",
};

export default function BookSession({ idToken }: { idToken: string }) {
  const [options, setOptions] = useState<Options | null>(null);
  const [coachId, setCoachId] = useState<string | null>(null);
  // 可複選，上限是 remaining。全有全無地送出——部分成功會逼出
  // 「哪幾堂成立了」的一整套額外語義。
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<string[] | null>(null);

  const load = useCallback(
    async (forCoach: string | null) => {
      const path = forCoach
        ? `/api/member/booking?coachId=${encodeURIComponent(forCoach)}`
        : "/api/member/booking";
      const d = await api<Options>(path, idToken);
      setOptions(d);
      if (d.selected) setCoachId(d.selected.coachId);
      return d;
    },
    [idToken],
  );

  // 首次載入在 effect 內直接接 promise，不呼叫上面的 load——
  // 在 effect 本體同步呼叫會設 state 的函式會觸發 cascading render。
  useEffect(() => {
    let cancelled = false;

    api<Options>("/api/member/booking", idToken)
      .then((d) => {
        if (cancelled) return;
        setOptions(d);
        if (d.selected) setCoachId(d.selected.coachId);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError((err as Error).message);
      });

    return () => {
      cancelled = true;
    };
  }, [idToken]);

  async function book() {
    if (!coachId || picked.length === 0) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      await api("/api/member/booking", idToken, {
        method: "POST",
        body: { coachId, startAts: picked },
      });
      setDone([...picked].sort());
    } catch (err) {
      const code = (err as Error).message;
      // 送出時伺服器會重新檢查，不信任這張可能已經放了十分鐘的畫面。
      // 被搶走就重抓時段表——只講「失敗」而不更新畫面，學員會再按同一格。
      setNotice(ERROR_MESSAGES[code] ?? `預約失敗（${code}）`);
      setPicked([]);
      await load(coachId).catch(() => undefined);
    } finally {
      setSubmitting(false);
    }
  }

  if (error && !options) {
    return (
      <Screen>
        <ErrorBox>{error}</ErrorBox>
      </Screen>
    );
  }
  if (!options) return <Screen>載入中…</Screen>;

  if (done) {
    const duration = options.selected?.durationMin ?? 0;
    return (
      <Screen>
        <Title>預約完成</Title>
        <Hint>
          已預約 {done.length} 堂，都排進課表了，教練也收到通知。課前會再提醒你一次。
        </Hint>
        <ul className="mt-4 space-y-1.5">
          {done.map((iso) => {
            const at = new Date(iso);
            return (
              <li key={iso} className="text-sm text-slate-700">
                {fmt(at, "M/d")}（{weekdayZh(at)}）{fmtTimeRange(at, duration)}
              </li>
            );
          })}
        </ul>
        <div className="mt-6">
          <Button
            onClick={() => {
              setDone(null);
              setPicked([]);
              void load(coachId);
            }}
          >
            再約
          </Button>
        </div>
      </Screen>
    );
  }

  // 多位可預約教練時先選人：把兩位教練的時段混在一張表，重疊時會出現
  // 同一格兩個選項，而各教練的時長還不一樣，版面立刻崩（SPEC.md §3.6）。
  if (!options.selected) {
    if (options.coaches.length === 0) {
      return (
        <Screen>
          <Title>預約課程</Title>
          <Hint>你的教練目前都沒有開放預約。想約課請直接聯絡教練。</Hint>
        </Screen>
      );
    }

    return (
      <Screen>
        <Title>預約課程</Title>
        <Hint>要跟哪位教練上課？</Hint>
        <ul className="mt-5 space-y-2">
          {options.coaches.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => {
                  setOptions(null);
                  load(c.id).catch((err: unknown) => setError((err as Error).message));
                }}
                className="w-full rounded-2xl bg-white px-4 py-4 text-left text-base font-medium text-slate-800 shadow-sm"
              >
                {c.name}
              </button>
            </li>
          ))}
        </ul>
      </Screen>
    );
  }

  const s = options.selected;
  const full = s.remaining <= 0;
  const atLimit = picked.length >= s.remaining;

  /**
   * 已選的時段會擋掉與它重疊的候選。時長 60 分鐘時 09:00 與 09:30
   * 各自都是空的，一起約卻會讓教練同一時間有兩堂課。
   * 伺服器也會擋（slots_overlap），這裡是為了不讓學員按了才被拒。
   */
  const blockedByPicked = (iso: string) =>
    picked.some(
      (p) =>
        p !== iso &&
        Math.abs(new Date(p).getTime() - new Date(iso).getTime()) <
          s.durationMin * 60_000,
    );

  return (
    <Screen>
      <Title>預約課程</Title>
      <Hint>
        {s.coachName} 教練・每堂 {s.durationMin} 分鐘
      </Hint>

      {options.coaches.length > 1 ? (
        <button
          type="button"
          onClick={() => {
            setOptions({ coaches: options.coaches, selected: null });
            setPicked([]);
          }}
          className="mt-1 text-sm font-medium text-[#06C755]"
        >
          換一位教練
        </button>
      ) : null}

      {notice ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {notice}
        </div>
      ) : null}

      {/*
        分母是「還能再約幾堂」，不是教練設的總上限——學員關心的是自己現在還能選幾個，
        而已經約掉的堂數另外說明，才不會讓 0/2 看起來像系統算錯。
      */}
      {full ? (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
          你已經約滿 {s.maxOpenBookings} 堂，上完課之後才能再約。
          需要臨時加課請直接聯絡教練。
        </div>
      ) : (
        <div className="mt-4 flex items-baseline justify-between rounded-xl border border-slate-200 bg-white px-4 py-3">
          <span className="text-sm text-slate-600">
            已選
            <span
              className={`ml-1.5 text-base font-semibold ${
                atLimit ? "text-[#06C755]" : "text-slate-900"
              }`}
            >
              {picked.length}/{s.remaining}
            </span>
          </span>
          <span className="text-xs text-slate-400">
            {s.openBookings > 0
              ? `上限 ${s.maxOpenBookings} 堂，已有 ${s.openBookings} 堂未上課`
              : `最多可預約 ${s.maxOpenBookings} 堂`}
          </span>
        </div>
      )}

      <div className="mt-5 space-y-4 pb-28">
        {s.days.length === 0 ? (
          <p className="text-sm text-slate-500">
            未來 {s.horizonDays} 天沒有可預約的時間。教練的時段可能都排滿了，
            請直接聯絡他。
          </p>
        ) : (
          s.days.map((day) => (
            <div key={day.date}>
              <h2 className="text-sm font-semibold text-slate-700">
                {fmtMonthDay(day.date)}（{weekdayZh(new Date(`${day.date}T00:00:00Z`))}）
              </h2>
              <div className="mt-2 flex flex-wrap gap-2">
                {day.starts.map((iso) => {
                  const on = picked.includes(iso);
                  // 已達上限時只剩「取消已選的」還能按，否則學員會一直按到沒反應。
                  const disabled =
                    full || submitting || blockedByPicked(iso) || (atLimit && !on);

                  return (
                    <button
                      key={iso}
                      type="button"
                      disabled={disabled}
                      onClick={() =>
                        setPicked((prev) =>
                          prev.includes(iso)
                            ? prev.filter((x) => x !== iso)
                            : [...prev, iso].sort(),
                        )
                      }
                      className={`rounded-xl px-3.5 py-2.5 text-sm font-medium transition ${
                        on
                          ? "bg-[#06C755] text-white"
                          : disabled
                            ? "bg-slate-100 text-slate-300"
                            : "bg-white text-slate-800 ring-1 ring-slate-200"
                      }`}
                    >
                      {fmt(new Date(iso), "HH:mm")}
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        )}

        <p className="text-xs leading-relaxed text-slate-400">
          最晚須於上課前 {s.leadHours} 小時預約。預約後會直接排進課表，
          無法出席請點下方選單請假。
        </p>
      </div>

      {picked.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 p-4 backdrop-blur">
          <div className="mx-auto max-w-md">
            {/* 列出每一堂的確切時間。只寫「共 N 堂」學員得自己回想選了哪些，
                而選錯的代價是要再請假一次。 */}
            <div className="mb-2 max-h-20 overflow-y-auto text-center text-sm leading-relaxed text-slate-600">
              {picked.map((iso) => (
                <p key={iso}>
                  {fmt(new Date(iso), "M/d")}（{weekdayZh(new Date(iso))}）
                  {fmtTimeRange(new Date(iso), s.durationMin)}
                </p>
              ))}
            </div>
            <Button onClick={() => void book()} disabled={submitting}>
              {submitting ? "預約中…" : `確認預約 ${picked.length} 堂`}
            </Button>
          </div>
        </div>
      ) : null}
    </Screen>
  );
}
