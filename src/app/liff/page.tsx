import { Suspense } from "react";
import LiffClient from "./liff-client";

// LIFF 必須在瀏覽器端初始化，且會依 URL 參數決定畫面，不可預先產生。
export const dynamic = "force-dynamic";

export default function LiffPage() {
  return (
    <Suspense fallback={<Centered>載入中…</Centered>}>
      <LiffClient />
    </Suspense>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center p-6 text-slate-500">
      {children}
    </div>
  );
}
