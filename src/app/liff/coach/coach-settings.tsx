"use client";

import { useEffect, useState } from "react";
import AvailabilityEditor from "./availability-editor";
import BlocksEditor from "./blocks-editor";
import { api } from "../api";
import CopyableText from "../copyable-text";
import type { Interval } from "@/lib/booking";
import {
  Button,
  Card,
  ErrorBox,
  Field,
  Screen,
  Section,
  Select,
  TextInput,
  Title,
} from "../ui";

type Settings = {
  name: string;
  oaUrl: string;
  defaultDuration: number;
  reminderHours: number;
  leaveDeadlineHours: number;
  bookingEnabled: boolean;
  bookingLeadHours: number;
  maxOpenBookings: number;
  icalUrl: string;
};

const ERROR_MESSAGES: Record<string, string> = {
  invalid_oa_url: "官方帳號格式不正確。請填 @ 開頭的 ID 或 line.me 開頭的網址。",
};

export default function CoachSettings({ idToken }: { idToken: string }) {
  const [initial, setInitial] = useState<Settings | null>(null);
  const [form, setForm] = useState<Settings | null>(null);
  // 可預約時段與設定分開儲存：它走自己的 PUT（整週替換），
  // 塞進 settings 的 PATCH 會讓那支 API 同時負責兩種形狀完全不同的資料。
  const [availability, setAvailability] = useState<Interval[] | null>(null);
  const [savedAvailability, setSavedAvailability] = useState<Interval[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api<Settings>("/api/coach/settings", idToken),
      api<{ intervals: Interval[] }>("/api/coach/availability", idToken),
    ])
      .then(([d, a]) => {
        if (cancelled) return;
        setInitial(d);
        setForm(d);
        setAvailability(a.intervals);
        setSavedAvailability(a.intervals);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [idToken]);

  async function save() {
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/coach/settings", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: form.name,
          oaUrl: form.oaUrl,
          defaultDuration: form.defaultDuration,
          reminderHours: form.reminderHours,
          leaveDeadlineHours: form.leaveDeadlineHours,
          bookingEnabled: form.bookingEnabled,
          bookingLeadHours: form.bookingLeadHours,
          maxOpenBookings: form.maxOpenBookings,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(ERROR_MESSAGES[data.error ?? ""] ?? `儲存失敗（${res.status}）`);
        return;
      }

      // 時段的儲存放在設定之後：時段寫失敗時設定已經存好，重按一次只會重送時段，
      // 反過來則會讓「已儲存」的時段搭上沒存到的開關。
      if (availability && JSON.stringify(availability) !== JSON.stringify(savedAvailability)) {
        const saved = await api<{ intervals: Interval[] }>(
          "/api/coach/availability",
          idToken,
          { method: "PUT", body: { intervals: availability } },
        );
        // 伺服器會正規化（合併重疊與相鄰），回傳的才是真正存下去的形狀。
        setAvailability(saved.intervals);
        setSavedAvailability(saved.intervals);
      }

      setInitial(form);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (error && !form) {
    return (
      <Screen>
        <ErrorBox>{error}</ErrorBox>
      </Screen>
    );
  }
  if (!form || !initial) return <Screen>載入中…</Screen>;

  const dirty =
    JSON.stringify(form) !== JSON.stringify(initial) ||
    JSON.stringify(availability) !== JSON.stringify(savedAvailability);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) =>
    setForm({ ...form, [k]: v });

  return (
    <Screen>
      <Title>設定</Title>

      <div className="mt-5 space-y-6 pb-28">
        <Section title="基本資料">
          <div className="space-y-4">
            <Field label="你的名字" hint="學員會看到這個名字">
              <TextInput
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                maxLength={40}
              />
            </Field>
            <Field label="你的官方帳號" hint="學員點「聯絡教練」會跳到這裡">
              <TextInput
                value={form.oaUrl}
                onChange={(e) => set("oaUrl", e.target.value)}
                maxLength={200}
              />
            </Field>
          </div>
        </Section>

        <Section title="排課預設值">
          <Field label="預設課程時長">
            <Select
              value={form.defaultDuration}
              onChange={(e) => set("defaultDuration", Number(e.target.value))}
            >
              {[30, 45, 60, 75, 90, 120].map((m) => (
                <option key={m} value={m}>
                  {m} 分鐘
                </option>
              ))}
            </Select>
          </Field>
        </Section>

        <Section title="通知">
          <div className="space-y-4">
            <Field label="課前多久提醒學員" hint="調整後只影響之後新排的課">
              <Select
                value={form.reminderHours}
                onChange={(e) => set("reminderHours", Number(e.target.value))}
              >
                {[1, 2, 3, 6, 12, 24, 48].map((h) => (
                  <option key={h} value={h}>
                    {h} 小時前
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="請假免確認期限"
              hint="超過這個時間前提出的請假直接完成，不需你確認"
            >
              <Select
                value={form.leaveDeadlineHours}
                onChange={(e) => set("leaveDeadlineHours", Number(e.target.value))}
              >
                {[0, 2, 6, 12, 24, 48, 72].map((h) => (
                  <option key={h} value={h}>
                    {h === 0 ? "一律需要我確認" : `${h} 小時前`}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Section>

        <Section
          title="學員預約"
          hint="開放後，學員可自己在你有空的時間約課"
        >
          <div className="space-y-4">
            <label className="flex items-center gap-2.5">
              <input
                type="checkbox"
                checked={form.bookingEnabled}
                onChange={(e) => set("bookingEnabled", e.target.checked)}
                className="size-5 accent-[#06C755]"
              />
              <span className="text-sm font-medium text-slate-700">開放學員預約</span>
            </label>

            {/*
              開關與「有沒有時段」是兩個真相來源（SPEC.md §3.6 刻意接受的代價）。
              這段紅字是唯一能讓教練察覺自己只做了一半的地方——少了它，
              他會一直納悶為什麼沒有人來預約。
            */}
            {form.bookingEnabled && availability?.length === 0 ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                你還沒設定任何可預約時段，學員目前仍無法預約。
              </div>
            ) : null}

            {form.bookingEnabled ? (
              <>
                <Field
                  label="最晚可在上課前多久預約"
                  hint="更晚提出的時段不會出現在學員的可選清單"
                >
                  <Select
                    value={form.bookingLeadHours}
                    onChange={(e) => set("bookingLeadHours", Number(e.target.value))}
                  >
                    {[2, 6, 12, 24, 48, 72].map((h) => (
                      <option key={h} value={h}>
                        {h} 小時前
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field
                  label="同時最多可預約幾堂"
                  hint="上完一堂就釋放一個額度。系統不記剩餘堂數，這是唯一的上限"
                >
                  <Select
                    value={form.maxOpenBookings}
                    onChange={(e) => set("maxOpenBookings", Number(e.target.value))}
                  >
                    {[1, 2, 3, 4, 5, 8, 12, 20].map((n) => (
                      <option key={n} value={n}>
                        {n} 堂
                      </option>
                    ))}
                  </Select>
                </Field>

                <div>
                  <p className="text-sm font-medium text-slate-700">可預約時段</p>
                  <p className="mt-0.5 mb-2 text-xs text-slate-400">
                    以週為單位。你自己排課不受這裡限制
                  </p>
                  {availability ? (
                    <AvailabilityEditor
                      intervals={availability}
                      onChange={setAvailability}
                    />
                  ) : null}
                </div>

                <div>
                  <p className="text-sm font-medium text-slate-700">封鎖時段</p>
                  <p className="mt-0.5 mb-2 text-xs text-slate-400">
                    出國、受傷、國定假日——這段時間學員約不到
                  </p>
                  <BlocksEditor idToken={idToken} />
                </div>
              </>
            ) : null}
          </div>
        </Section>

        <Section title="同步到 Google 日曆" hint="一次性設定，之後自動更新">
          <Card>
            <ol className="mb-3 space-y-1 text-xs leading-relaxed text-slate-600">
              <li>1. 複製下方網址</li>
              <li>2. 電腦開啟 Google 日曆 → 左側「其他日曆」旁的ᐩ</li>
              <li>3. 選「以網址新增」，貼上後儲存</li>
            </ol>
            <CopyableText
              text={form.icalUrl}
              buttonLabel="複製訂閱網址"
              hint="或長按下方網址手動複製"
            />
            <p className="mt-3 text-xs text-slate-400">
              此網址含個人代號，請勿外流。行事曆為唯讀，在 Google
              日曆上的修改不會回傳，課程異動請回到排課功能操作。
            </p>
          </Card>
        </Section>

        {error ? <ErrorBox>{error}</ErrorBox> : null}
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 p-4 backdrop-blur">
        <div className="mx-auto max-w-md">
          <Button onClick={() => void save()} disabled={!dirty || saving}>
            {saving ? "儲存中…" : saved ? "✓ 已儲存" : "儲存變更"}
          </Button>
        </div>
      </div>
    </Screen>
  );
}
