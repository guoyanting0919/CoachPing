# 環境設定指引

這份文件涵蓋**只能由你手動完成**的設定（LINE 後台、Neon、Vercel）。
照著順序做，每步打勾。程式碼部分不需要你動手。

---

## ⚠️ 最重要的一件事

**LINE Login channel 與 Messaging API channel 必須建在同一個 Provider 底下。**

兩者若不同 Provider，取得的 `userId` 會不一致，整套推播會靜默失效——而且這是**不可逆的**，建錯只能全部重來。這是第 1 步就要做對的事。

另外：**LIFF 不能掛在 Messaging API channel 上**（LINE 自 2020/02/05 起停止新增此功能）。LIFF 必須掛在 LINE Login channel。

---

## 1. LINE Developers Console

前往 https://developers.line.biz/console/

- [ ] **1.1** 建立一個 **Provider**（名稱隨意，例如 `FitCoach`）。整個專案只需要一個。

- [ ] **1.2** 取得 **Messaging API channel**。兩條路徑擇一：

  **(a) 已經有想用的官方帳號** ← 建議
  前往 https://manager.line.biz/ → 該帳號 → 設定 → **Messaging API** → 啟用
  - 「選擇服務提供者」跳出時，**務必選 1.1 建立的那個 Provider**，不要新建也不要選其他既有的
  - 接著跳出的「隱私權政策／服務條款」兩欄皆為**選填**，可直接按確定跳過，日後隨時能補
  - 啟用後該 channel 會出現在 LINE Developers Console 的該 Provider 底下

  **(b) 還沒有官方帳號**
  在 LINE Developers Console 該 Provider 下建立 Messaging API channel，會同時產生一個新的官方帳號。Channel name 就是學員看到的帳號名稱。

  兩條路徑都要記下：**Basic settings → Channel secret** → 填入 `.env` 的 `LINE_CHANNEL_SECRET`

- [ ] **1.3** **Messaging API 分頁 → Channel access token (long-lived) → Issue**
  - 填入 `.env` 的 `LINE_CHANNEL_ACCESS_TOKEN`
  - 這串很長，注意複製完整

- [ ] **1.4** 回到**同一個 Provider**，建立 **LINE Login channel**
  - App types 勾選 **Web app**

- [ ] **1.5** LINE Login channel → **Basic settings → Linked LINE Official Account**
  - 選擇 1.2 建立的那個官方帳號
  - **這一步不能跳過**：沒有連結，LIFF 就無法用 `liff.getFriendship()` 判斷使用者是否已加好友，註冊流程會擋不住未加好友的人

- [ ] **1.6** LINE Login channel → **LIFF 分頁 → Add**
  - Size：**Full**
  - Endpoint URL：先填 `https://example.com/liff`（稍後改成真實網址）
  - Scopes：勾選 **profile**、**openid**
  - Add friend option：**On (Aggressive)** ← 讓未加好友者直接看到加好友提示
  - 建立後記下 **LIFF ID**（形如 `2000000000-abcdefgh`）→ 填入 `.env` 的 `NEXT_PUBLIC_LIFF_ID`

---

## 2. LINE Official Account Manager

前往 https://manager.line.biz/ ，選擇 1.2 產生的帳號。

- [ ] **2.1** 設定 → **回應設定**
  - **Webhook**：**開啟** ← 必要，不開的話本系統收不到任何事件
  - **自動回應訊息**：**關閉** ← 不關會跟 webhook 的回覆打架，學員收到兩則
  - **加入好友的歡迎訊息**：**關閉** ← 由 webhook 的 follow 事件處理，才能帶教練名字
  - **聊天**：開關皆可。本系統全部靠 webhook 自動回覆，不需要人工客服信箱，
    關閉比較單純（開啟只是多一個你要去看的收件匣）

- [ ] **2.2** 設定 → 帳號設定 → 記下你的官方帳號 ID（`@xxxxxxx`），加好友網址為 `https://line.me/R/ti/p/@xxxxxxx`

---

## 3. Neon（資料庫）

前往 https://console.neon.tech/

- [ ] **3.1** 建立 Project
  - Region 選 **AWS ap-southeast-1 (Singapore)**，離台灣最近

- [ ] **3.2** 建立完成後 Neon 會顯示兩條連線字串，**兩條都要填**：

  | Neon 顯示的名稱 | 主機名 | 填到 `.env` 的 | 用途 |
  |---|---|---|---|
  | `DATABASE_URL_POOLED` | 帶 `-pooler` | `DATABASE_URL` | 應用程式執行時 |
  | `DATABASE_URL` | 不帶 `-pooler` | `DIRECT_URL` | `db push` / `migrate` |

  > 注意兩邊名稱是**交錯**的，別直接照抄貼上。
  > 應用程式必須走 pooled：Vercel serverless 會開大量短連線，直連會爆連線數。
  > 遷移必須走 direct：DDL 操作走 PgBouncer 交易模式會失敗。

---

## 4. 本機環境

- [ ] **4.1** 編輯 `.env`（範本已建好，直接填值即可）

  還要自己產一組 cron 密鑰：

  ```bash
  openssl rand -hex 32   # 填入 CRON_SECRET
  ```

- [ ] **4.2** 建立資料表

  ```bash
  npm run db:push
  ```

  > schema 還在變動期，先用 `db:push` 快速同步。等資料表穩定後改用
  > `npm run db:migrate` 產生 migration 檔納入版控。

- [ ] **4.3** 啟動

  ```bash
  npm run dev
  ```

---

## 5. 讓 LINE 打得到你的本機（開發期）

LINE 的 webhook 和 LIFF 都要求 HTTPS 公開網址，本機 `localhost` 不行。

- [ ] **5.1** 開一個通道（擇一）

  ```bash
  cloudflared tunnel --url http://localhost:3000
  # 或 ngrok http 3000
  ```

  網址藏在一大片日誌中間的方框裡，形如
  `https://xxxx-xxxx-xxxx.trycloudflare.com`。

- [ ] **5.2** Messaging API channel → **Messaging API 分頁 → Webhook URL**
  - 填 `https://xxxx.ngrok-free.app/api/line/webhook`
  - 按 **Verify**，要顯示 Success
  - **Use webhook**：開啟

- [ ] **5.3** LINE Login channel → LIFF → 編輯剛才的 LIFF app
  - Endpoint URL 改成 `https://xxxx.ngrok-free.app/liff`

- [ ] **5.4** `.env` 的 `APP_BASE_URL` 也改成同一個網址（不加結尾斜線）

- [ ] **5.5** `next.config.ts` 的 `allowedDevOrigins` 也改成該網址的**主機名**（不含 `https://`）
  - 不改的話 Next.js 16 會擋掉來自通道的 HMR 與內部資源請求

> 通道網址每次重啟都會變，屆時 5.2 ~ 5.5 **四處**都要跟著改。
> 覺得煩的話，直接部署到 Vercel preview 用固定網址開發也可以。

---

## 6. 部署到 Vercel

- [ ] **6.1** 把 repo 推上 GitHub，在 Vercel import

- [ ] **6.2** Vercel → Settings → Environment Variables
  - 把 `.env` 裡的所有變數都填進去（`NEXT_PUBLIC_LIFF_ID` 也要）
  - `APP_BASE_URL` 改成正式網址

- [ ] **6.3** 部署完成後，把第 5 步的三個網址全部改成正式網址
  - Webhook URL → `https://your-app.vercel.app/api/line/webhook`
  - LIFF Endpoint URL → `https://your-app.vercel.app/liff`

---

## 7. 驗收

- [ ] 用手機加入官方帳號好友 → 應收到「歡迎加入！請點下方選單完成註冊」
- [ ] 對帳號傳任意訊息 → 應收到「請先點下方選單完成註冊」
- [ ] `npm run db:studio` 開得起來，看得到 8 張表

以上通過，第 1 項就完成了。

---

## 附註：後續項目才會用到的設定

- **Rich Menu**（第 2 項）：由程式透過 API 建立，屆時會產生三組 ID 填回 `.env`
- **LINE Login 網頁版**（桌面入口）：LINE Login channel → Callback URL 加入 `https://your-app.vercel.app/api/auth/line/callback`

---

## 8. 推播排程（第 5 項）

推播不會自己送出——`/api/cron/dispatch` 必須由外部排程**每 30 分鐘**呼叫一次。
沒設定的話課程照排、提醒照排入佇列，但課前提醒一則都不會發出去。

> **為什麼是 30 分鐘不是 1 分鐘**：Neon 免費方案每月只有 100 CU-hours，而資料庫閒置
> 5 分鐘才會自動休眠。每分鐘輪詢會讓它 24 小時不休眠，約 17 天就耗盡算力並被停用，
> 屆時整個服務（LIFF、webhook、後台）會一起掛掉。
>
> 取消／改期／請假這類「使用者剛觸發」的通知**不受這個間隔影響**——那幾支 API 會在
> 回應送出後直接派送一次（SPEC.md §5），延遲是 0。cron 只負責到點的課前提醒。

Vercel Hobby 方案的內建 cron 每天只能跑一次，因此走外部服務。擇一：

**cron-job.org**（免費，最簡單）
- [ ] 註冊後新增 cronjob
- [ ] URL：`https://coachping.vercel.app/api/cron/dispatch`
- [ ] Request method：**POST**
- [ ] Schedule：**Every 30 minutes**
- [ ] Headers 加一列：`Authorization: Bearer <你的 CRON_SECRET>`

**Upstash QStash**（免費額度足夠）
- [ ] Console → Schedules → Create
- [ ] Destination：同上網址，方法 POST
- [ ] Cron：`*/30 * * * *`
- [ ] Header：`Authorization: Bearer <你的 CRON_SECRET>`

`CRON_SECRET` 在本機 `.env` 裡。設定完成後可手動驗證：

```bash
curl -X POST https://coachping.vercel.app/api/cron/dispatch \
  -H "Authorization: Bearer $CRON_SECRET"
# 應回 {"reclaimed":0,"claimed":0,"sent":0,"failed":0}
```

回 401 表示密鑰不符；回 200 但 `sent` 為 0 是正常的——代表當下沒有到期的提醒。

