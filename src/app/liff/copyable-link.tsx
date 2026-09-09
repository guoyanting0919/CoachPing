"use client";

import { useState } from "react";

/**
 * 邀請連結的複製元件。
 * LINE 內建瀏覽器的 clipboard API 不保證可用，複製失敗時退回顯示可長按選取的文字。
 */
export default function CopyableLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setFailed(true);
    }
  }

  return (
    <div>
      <button
        onClick={() => void copy()}
        className="w-full rounded-xl border border-[#06C755] bg-[#06C755]/5 px-4 py-2.5 text-sm font-semibold text-[#06C755]"
      >
        {copied ? "✓ 已複製" : "複製邀請連結"}
      </button>

      {failed ? (
        <p className="mt-2 rounded-lg bg-slate-100 p-2 text-xs break-all text-slate-600 select-all">
          {url}
        </p>
      ) : null}
    </div>
  );
}
