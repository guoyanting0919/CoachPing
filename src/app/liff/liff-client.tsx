"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import CoachApp from "./coach/coach-app";
import CoachRegisterForm from "./coach-register-form";
import MemberApp from "./member/member-app";
import MemberRegisterForm from "./member/member-register-form";
import { Button, Centered, ErrorBox, Hint, Screen, Title } from "./ui";

type SessionResult =
  | { role: "coach"; coach: { id: string; name: string }; lineName?: string }
  | { role: "member"; member: { id: string; displayName: string }; lineName?: string }
  | {
      role: "none";
      lineName?: string;
      invite:
        | { kind: "coach"; valid: boolean; label: string }
        | { kind: "member"; valid: boolean; coachName: string; suggestedName: string }
        | null;
    };

type State =
  | { kind: "loading" }
  /** liff.login() 會離開本頁，此狀態下不該再渲染任何東西。 */
  | { kind: "redirecting" }
  | { kind: "need-friend" }
  | { kind: "error"; message: string }
  | { kind: "ready"; idToken: string; session: SessionResult };

const OA_URL = `https://line.me/R/ti/p/${process.env.NEXT_PUBLIC_OA_BASIC_ID ?? ""}`;

/**
 * 取得目前狀態。刻意寫成「回傳下一個狀態」而非直接 setState，
 * 讓所有狀態更新集中在 effect 的 callback 中，避免卸載後才回來的請求寫入狀態。
 */
async function resolveState(inviteToken: string | undefined): Promise<State> {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  if (!liffId) {
    return { kind: "error", message: "系統設定缺少 LIFF ID，請聯絡管理者。" };
  }

  const liff = (await import("@line/liff")).default;
  await liff.init({ liffId });

  // 在外部瀏覽器開啟時導向 LINE 登入；在 LINE 內開啟則已自動登入。
  if (!liff.isLoggedIn()) {
    liff.login({ redirectUri: window.location.href });
    return { kind: "redirecting" };
  }

  // 未加好友就無法推播，等於整套功能失效，因此在此擋住。
  // LIFF 未連結官方帳號時這個 API 會拋錯，此時略過檢查而非中斷流程。
  try {
    const friendship = await liff.getFriendship();
    if (!friendship.friendFlag) return { kind: "need-friend" };
  } catch {
    console.warn("[liff] 無法取得好友狀態，略過檢查");
  }

  const idToken = liff.getIDToken();
  if (!idToken) {
    return {
      kind: "error",
      message: "無法取得身分資訊。請確認 LIFF 已開啟 openid 權限。",
    };
  }

  const res = await fetch("/api/liff/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken, inviteToken }),
  });
  if (!res.ok) {
    return { kind: "error", message: `身分驗證失敗（${res.status}）` };
  }

  return { kind: "ready", idToken, session: (await res.json()) as SessionResult };
}

export default function LiffClient() {
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("t") ?? undefined;
  // Rich Menu 各按鈕會帶 ?p=<page>，決定進來後看到哪個畫面。
  const page = searchParams.get("p");

  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setState({ kind: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    resolveState(inviteToken)
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch((err: unknown) => {
        console.error(err);
        if (!cancelled) {
          setState({ kind: "error", message: (err as Error).message || "初始化失敗" });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [inviteToken, attempt]);

  if (state.kind === "loading" || state.kind === "redirecting") {
    return <Centered>載入中…</Centered>;
  }

  if (state.kind === "error") {
    return (
      <Centered>
        <ErrorBox>{state.message}</ErrorBox>
        <div className="mt-4">
          <Button onClick={retry}>重試</Button>
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
          <button onClick={retry} className="w-full py-2 text-sm text-slate-500 underline">
            我已加入，重新檢查
          </button>
        </div>
      </Screen>
    );
  }

  const { session, idToken } = state;

  if (session.role === "coach") {
    return <CoachApp idToken={idToken} page={page} />;
  }

  if (session.role === "member") {
    return (
      <MemberApp
        idToken={idToken}
        memberName={session.member.displayName}
        page={page}
      />
    );
  }

  const invite = session.invite;

  if (!invite) {
    return (
      <Screen>
        <Title>需要邀請連結</Title>
        <Hint>這個頁面要透過教練提供的專屬連結才能開啟。請向你的教練索取邀請連結。</Hint>
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
        onDone={retry}
      />
    );
  }

  return (
    <MemberRegisterForm
      idToken={idToken}
      inviteToken={inviteToken!}
      coachName={invite.coachName}
      suggestedName={invite.suggestedName || (session.lineName ?? "")}
      onDone={retry}
    />
  );
}
