import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 透過 cloudflared / ngrok 通道存取 dev server 時，Next.js 會擋下跨來源的
  // HMR 與內部資源請求。開發用通道網址每次重啟都會變，換了就改這裡。
  allowedDevOrigins: ["coachping.vercel.app"],
  /* config options here */
};

export default nextConfig;
