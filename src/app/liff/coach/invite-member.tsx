"use client";

import { useState } from "react";
import { api } from "../api";
import CopyableText from "../copyable-text";
import { Button, ErrorBox, Field, Hint, Screen, TextInput, Title } from "../ui";

type CreateResult = { member: { id: string; name: string }; inviteUrl: string };

export default function InviteMember({
  idToken,
  onBack,
}: {
  idToken: string;
  onBack: () => void;
}) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateResult | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      setResult(
        await api<CreateResult>("/api/coach/members", idToken, {
          method: "POST",
          body: { name: name.trim() },
        }),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <Screen>
        <Title>已建立「{result.member.name}」</Title>
        <Hint>
          把下面的連結用你自己的官方帳號傳給他。這條連結只能用一次，而且只屬於這位學員。
        </Hint>

        <div className="mt-5 rounded-2xl bg-white p-4 shadow-sm">
          <CopyableText
            text={result.inviteUrl}
            buttonLabel="複製邀請連結"
            shareText={`這是你的專屬加入連結，點開填一下名字就完成了：\n${result.inviteUrl}`}
          />
        </div>

        <p className="mt-5 text-sm text-slate-500">
          他還沒加入之前你就可以先幫他排課，只是系統無法自動通知他。
        </p>

        <div className="mt-6 space-y-3">
          <Button
            onClick={() => {
              setResult(null);
              setName("");
            }}
          >
            再邀請一位
          </Button>
          <button
            onClick={onBack}
            className="w-full py-2 text-sm text-slate-500 underline"
          >
            回到學員清單
          </button>
        </div>
      </Screen>
    );
  }

  return (
    <Screen>
      <div className="flex items-center justify-between">
        <Title>邀請學員</Title>
        <button onClick={onBack} className="text-sm text-slate-500">
          返回
        </button>
      </div>
      <Hint>填學員的名字，系統會產生一條專屬連結給你轉傳。</Hint>

      <form onSubmit={submit} className="mt-6 space-y-5">
        <Field label="學員名字" hint="只有你看得到，取你認得出來的就好">
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
          {submitting ? "產生中…" : "產生邀請連結"}
        </Button>
      </form>
    </Screen>
  );
}
