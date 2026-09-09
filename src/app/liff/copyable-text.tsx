"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 可複製的文字區塊。
 *
 * LINE 內建瀏覽器（尤其 Android）經常擋掉 navigator.clipboard，所以有三條路徑：
 *   1. LINE 的分享選擇器 —— 可用時最順
 *   2. 複製按鈕 —— 先試新版 API，失敗退回 execCommand
 *   3. 永遠顯示可長按選取的文字 —— 前兩者全掛時的保底，不藏起來
 */
export default function CopyableText({
  text,
  buttonLabel = "複製",
  shareText,
  hint,
}: {
  text: string;
  buttonLabel?: string;
  /** 提供時才顯示 LINE 分享按鈕。 */
  shareText?: string;
  hint?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!shareText) return;
    let cancelled = false;

    import("@line/liff")
      .then(({ default: liff }) => {
        if (!cancelled) setCanShare(liff.isApiAvailable("shareTargetPicker"));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [shareText]);

  async function share() {
    try {
      const { default: liff } = await import("@line/liff");
      await liff.shareTargetPicker([{ type: "text", text: shareText ?? text }]);
    } catch (err) {
      console.error("[share] 分享失敗", err);
    }
  }

  async function copy() {
    setCopyFailed(false);

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        flash();
        return;
      }
    } catch {
      // 落到下面的舊版做法
    }

    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "0";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (ok) {
        flash();
        return;
      }
    } catch {
      // 兩種都失敗，改請使用者長按下方文字
    }

    setCopyFailed(true);
    selectBody();
  }

  function flash() {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  /** 複製失敗時直接幫使用者把文字選起來，只剩「長按 → 複製」一步。 */
  function selectBody() {
    const el = bodyRef.current;
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
          用 LINE 傳送
        </button>
      ) : null}

      <button
        onClick={() => void copy()}
        className="w-full rounded-xl border border-[#06C755] bg-[#06C755]/5 px-4 py-2.5 text-sm font-semibold text-[#06C755] active:scale-[0.99]"
      >
        {copied ? "✓ 已複製" : buttonLabel}
      </button>

      <div>
        <p className="mb-1 text-xs text-slate-400">
          {copyFailed ? "自動複製失敗，請長按下方文字複製" : (hint ?? "或長按下方文字手動複製")}
        </p>
        <div
          ref={bodyRef}
          onClick={selectBody}
          className="rounded-lg border border-slate-200 bg-white p-3 text-xs leading-relaxed break-all whitespace-pre-wrap text-slate-700 select-all"
        >
          {text}
        </div>
      </div>
    </div>
  );
}
