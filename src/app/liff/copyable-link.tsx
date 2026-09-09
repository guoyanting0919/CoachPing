"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 邀請連結的分享元件。
 *
 * LINE 內建瀏覽器（尤其 Android）經常擋掉 navigator.clipboard，所以這裡有三條路徑：
 *   1. LINE 的分享選擇器 —— 可用時最順，直接選聊天室送出
 *   2. 複製按鈕 —— 先試新版 API，失敗退回 execCommand
 *   3. 永遠顯示可長按選取的連結 —— 前兩者全掛時的保底，不藏起來
 */
export default function CopyableLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const linkRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    import("@line/liff")
      .then(({ default: liff }) => {
        // 分享選擇器需要 LIFF 設定開啟且授予 chat_message.write，未開啟時隱藏按鈕。
        if (!cancelled) setCanShare(liff.isApiAvailable("shareTargetPicker"));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  async function share() {
    try {
      const { default: liff } = await import("@line/liff");
      await liff.shareTargetPicker([
        {
          type: "text",
          text: `這是你的專屬加入連結，點開填一下名字就完成了：\n${url}`,
        },
      ]);
    } catch (err) {
      console.error("[share] 分享失敗", err);
    }
  }

  async function copy() {
    setCopyFailed(false);

    // 新版 API：需要安全內容與使用者手勢，WebView 常拒絕。
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        flashCopied();
        return;
      }
    } catch {
      // 落到下面的舊版做法
    }

    // 舊版 execCommand：在多數 WebView 仍然可用。
    try {
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "0";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, url.length);
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (ok) {
        flashCopied();
        return;
      }
    } catch {
      // 兩種都失敗，改請使用者長按下方連結
    }

    setCopyFailed(true);
    selectLinkText();
  }

  function flashCopied() {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  /** 複製失敗時直接幫使用者把文字選起來，只剩「長按 → 複製」一步。 */
  function selectLinkText() {
    const el = linkRef.current;
    if (!el) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  return (
    <div className="space-y-3">
      {canShare ? (
        <button
          onClick={() => void share()}
          className="w-full rounded-xl bg-[#06C755] px-4 py-3 text-sm font-semibold text-white active:scale-[0.99]"
        >
          用 LINE 傳送給學員
        </button>
      ) : null}

      <button
        onClick={() => void copy()}
        className="w-full rounded-xl border border-[#06C755] bg-[#06C755]/5 px-4 py-2.5 text-sm font-semibold text-[#06C755] active:scale-[0.99]"
      >
        {copied ? "✓ 已複製" : "複製連結"}
      </button>

      {/* 保底路徑：永遠顯示，不等失敗才出現。 */}
      <div>
        <p className="mb-1 text-xs text-slate-400">
          {copyFailed ? "自動複製失敗，請長按下方連結複製" : "或長按下方連結手動複製"}
        </p>
        <div
          ref={linkRef}
          onClick={selectLinkText}
          className="rounded-lg border border-slate-200 bg-white p-3 text-xs leading-relaxed break-all text-slate-700 select-all"
        >
          {url}
        </div>
      </div>
    </div>
  );
}
