import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 透過 cloudflared / ngrok 通道存取 dev server 時，Next.js 會擋下跨來源的
  // HMR 與內部資源請求。開發用通道網址每次重啟都會變，換了就改這裡。
  allowedDevOrigins: ["coachping.vercel.app"],

  // LINE 內建瀏覽器會快取 LIFF 的 HTML，導致部署後手機上仍是舊畫面。
  // 只需禁止快取 HTML；JS／CSS 帶內容雜湊，換版就換網址，不受影響。
  async headers() {
    return [
      {
        source: "/liff",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
