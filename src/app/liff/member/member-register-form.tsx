"use client";

import { useState } from "react";
import { Button, ErrorBox, Field, Hint, Screen, TextInput, Title } from "../ui";

const ERROR_MESSAGES: Record<string, string> = {
  invite_not_found: "邀請連結無效。",
  invite_used: "這條邀請連結已經被使用過了。",
  invite_expired: "這條邀請連結已過期，請向教練索取新的。",
  invalid_id_token: "身分驗證失敗，請重新開啟連結。",
};

export default function MemberRegisterForm({
  idToken,
  inviteToken,
  coachName,
  suggestedName,
  onDone,
}: {
  idToken: string;
  inviteToken: string;
  coachName: string;
  suggestedName: string;
  onDone: () => void;
}) {
  const [name, setName] = useState(suggestedName);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/member/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken, inviteToken, name: name.trim() }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(ERROR_MESSAGES[data.error ?? ""] ?? `加入失敗（${res.status}）`);
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
      <Title>加入 {coachName} 教練</Title>
      <Hint>加入後就會收到上課提醒，也能直接在這裡請假。</Hint>

      <form onSubmit={submit} className="mt-6 space-y-5">
        <Field label="你的名字" hint="請填教練認得的名字">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="小明"
            maxLength={40}
            required
          />
        </Field>

        {error ? <ErrorBox>{error}</ErrorBox> : null}

        <Button type="submit" disabled={submitting || !name.trim()}>
          {submitting ? "加入中…" : "確認加入"}
        </Button>
      </form>
    </Screen>
  );
}
