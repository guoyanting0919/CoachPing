"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import CoachRegisterForm from "./coach-register-form";
import { Button, Centered, ErrorBox, Hint, Screen, Title } from "./ui";

type SessionResult =
  | { role: "coach"; coach: { id: string; name: string }; lineName?: string }
  | { role: "member"; member: { id: string; displayName: string }; lineName?: string }
  | {
      role: "none";
      lineName?: string;
      invite:
        | { kind: "coach"; valid: boolean; label: string }
        | {
            kind: "member";
            valid: boolean;
            coachName: string;
            suggestedName: string;
          }
        | null;
    };

type State =
  | { kind: "loading"; message: string }
  | { kind: "need-friend" }
  | { kind: "error"; message: string }
  | { kind: "ready"; idToken: string; session: SessionResult };

const OA_URL = `https://line.me/R/ti/p/${process.env.NEXT_PUBLIC_OA_BASIC_ID ?? ""}`;

export default function LiffClient() {
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("t") ?? undefined;

  const [state, setState] = useState<State>({ kind: "loading", message: "載入中…" });

  const boot = useCallback(async () => {
    setState({ kind: "loading", message: "載入中…" });

    const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
    if (!liffId) {
      setState({ kind: "error", message: "系統設定缺少 LIFF ID，請聯絡管理者。" });
      return;
    }

    try {
      const liff = (await import("@line/liff")).default;
      await liff.init({ liffId });

      // 在外部瀏覽器開啟時導向 LINE 登入；在 LINE 內開啟則已自動登入。
      if (!liff.isLoggedIn()) {
        liff.login({ redirectUri: window.location.href });
        return;
      }

      // 未加好友就無法推播，等於整套功能失效，因此在此擋住。
      // LIFF 未連結官方帳號時這個 API 會拋錯，此時略過檢查而非中斷流程。
      try {
        const friendship = await liff.getFriendship();
        if (!friendship.friendFlag) {
          setState({ kind: "need-friend" });
          return;
        }
      } catch {
        console.warn("[liff] 無法取得好友狀態，略過檢查");
      }

      const idToken = liff.getIDToken();
      if (!idToken) {
        setState({
          kind: "error",
          message: "無法取得身分資訊。請確認 LIFF 已開啟 openid 權限。",
        });
        return;
      }

      const res = await fetch("/api/liff/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken, inviteToken }),
      });
      if (!res.ok) {
        setState({ kind: "error", message: `身分驗證失敗（${res.status}）` });
        return;
      }

      setState({ kind: "ready", idToken, session: (await res.json()) as SessionResult });
    } catch (err) {
      console.error(err);
      setState({ kind: "error", message: (err as Error).message || "初始化失敗" });
    }
  }, [inviteToken]);

  useEffect(() => {
    void boot();
  }, [boot]);

  if (state.kind === "loading") {
    return <Centered>{state.message}</Centered>;
  }

  if (state.kind === "error") {
    return (
      <Centered>
        <ErrorBox>{state.message}</ErrorBox>
        <div className="mt-4">
          <Button onClick={() => void boot()}>重試</Button>
        </div>
      </Centered>
    );
  }

  if (state.kind === "need-friend") {
    return (
      <Screen>
        <Title>請先加入好友</Title>
        <Hint>
          課程提醒與異動通知都會透過這個官方帳號發送。加入好友後回到這個頁面就能繼續。
        </Hint>
        <div className="mt-6 space-y-3">
          <a href={OA_URL} target="_blank" rel="noreferrer" className="block">
            <Button>加入好友</Button>
          </a>
          <button
            onClick={() => void boot()}
            className="w-full py-2 text-sm text-slate-500 underline"
          >
            我已加入，重新檢查
          </button>
        </div>
      </Screen>
    );
  }

  const { session, idToken } = state;

  if (session.role === "coach") {
    return (
      <Screen>
        <Title>{session.coach.name} 教練</Title>
        <Hint>排課與學員管理功能開發中，請先使用下方選單。</Hint>
      </Screen>
    );
  }

  if (session.role === "member") {
    return (
      <Screen>
        <Title>{session.member.displayName}</Title>
        <Hint>課表查詢與請假功能開發中，請先使用下方選單。</Hint>
      </Screen>
    );
  }

  // 尚未註冊，依邀請碼決定要顯示哪張表單。
  const invite = session.invite;

  if (!invite) {
    return (
      <Screen>
        <Title>需要邀請連結</Title>
        <Hint>
          這個頁面要透過教練提供的專屬連結才能開啟。請向你的教練索取邀請連結。
        </Hint>
      </Screen>
    );
  }

  if (!invite.valid) {
    return (
      <Screen>
        <Title>此邀請連結已失效</Title>
        <Hint>連結可能已被使用過或已過期。請向提供連結的人索取新的邀請連結。</Hint>
      </Screen>
    );
  }

  if (invite.kind === "coach") {
    return (
      <CoachRegisterForm
        idToken={idToken}
        inviteToken={inviteToken!}
        defaultName={session.lineName ?? ""}
        onDone={() => void boot()}
      />
    );
  }

  return (
    <Screen>
      <Title>加入 {invite.coachName} 教練</Title>
      <Hint>學員註冊功能開發中。</Hint>
    </Screen>
  );
}
