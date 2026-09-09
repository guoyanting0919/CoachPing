"use client";

import { useState } from "react";
import { Button, ErrorBox, Field, Hint, Screen, Select, TextInput, Title } from "./ui";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_oa_url: "官方帳號連結格式不正確。請填 @ 開頭的 ID 或 line.me 開頭的網址。",
  invite_not_found: "邀請碼不存在。",
  invite_used: "這組邀請碼已被使用過。",
  invite_expired: "這組邀請碼已過期。",
  invalid_id_token: "身分驗證失敗，請重新開啟連結。",
};

export default function CoachRegisterForm({
  idToken,
  inviteToken,
  defaultName,
  onDone,
}: {
  idToken: string;
  inviteToken: string;
  defaultName: string;
  onDone: () => void;
}) {
  const [name, setName] = useState(defaultName);
  const [oaUrl, setOaUrl] = useState("");
  const [defaultDuration, setDefaultDuration] = useState(60);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/coach/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken, inviteToken, name, oaUrl, defaultDuration }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(ERROR_MESSAGES[data.error ?? ""] ?? `註冊失敗（${res.status}）`);
        return;
      }

      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen>
      <Title>教練註冊</Title>
      <Hint>填完之後就能開始排課，學員會自動收到上課提醒。</Hint>

      <form onSubmit={submit} className="mt-6 space-y-5">
        <Field label="你的名字" hint="學員會看到這個名字">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="王小明"
            maxLength={40}
            required
          />
        </Field>

        <Field
          label="你的官方帳號"
          hint="學員點「聯絡教練」時會跳到這裡。填 @ 開頭的 ID 最簡單"
        >
          <TextInput
            value={oaUrl}
            onChange={(e) => setOaUrl(e.target.value)}
            placeholder="@abc1234"
            maxLength={200}
            required
          />
        </Field>

        <Field label="預設課程時長" hint="排課時仍可單堂調整">
          <Select
            value={defaultDuration}
            onChange={(e) => setDefaultDuration(Number(e.target.value))}
          >
            {[30, 45, 60, 75, 90, 120].map((m) => (
              <option key={m} value={m}>
                {m} 分鐘
              </option>
            ))}
          </Select>
        </Field>

        {error ? <ErrorBox>{error}</ErrorBox> : null}

        <Button type="submit" disabled={submitting || !name.trim() || !oaUrl.trim()}>
          {submitting ? "註冊中…" : "完成註冊"}
        </Button>
      </form>
    </Screen>
  );
}
