# 健身教練排課推播系統 — MVP 規格

> 版本 0.1 ／ 2026-09-09
> 本文件是設計決策的唯一真實來源。實作與本文件衝突時，先改文件再改程式。

---

## 1. 產品定位

**賣給誰**：連鎖健身房的私人教練（非獨立私教）。他們被迫使用健身房內部 app，但那個 app 難用，所以多數人另外用 Google Calendar 自己記課表。

**解決什麼**：教練排課後，學員經常忘記來上課，因為沒有任何自動通知。教練目前用自己的 LINE 官方帳號逐一手動提醒。

**產品本質**：核心是**教練願意每天打開的排課工具**，推播只是它的輸出。沒有課表資料，推播就沒東西可推。資源分配應為排課體驗 70%、推播 30%。

**不取代什麼**：不取代教練自己的 LINE 官方帳號。教練繼續用他的 OA 跟學員閒聊、溝通。本系統只負責排課、通知、請假。

---

## 2. 角色

| 角色 | 身分識別 | 入口 |
|---|---|---|
| 教練 | LINE userId | 專屬邀請連結（前期由開發者手動產生） |
| 學員 | LINE userId | 教練產生的一次性邀請連結 |

一個 LINE 使用者理論上可同時是教練與學員，但 MVP 不處理此情境（以先註冊的角色為準）。

---

## 3. 核心流程

### 3.1 教練上線

1. 開發者手動產生教練邀請連結 `https://liff.line.me/{liffId}?t={token}`
2. 教練在 LINE 內開啟 → LIFF 取得 userId
3. 若尚未加好友（`liff.getFriendship()` 為 false）→ 顯示「加入好友」按鈕擋住流程
4. 填寫：姓名、**自己官方帳號的連結**（必填）、預設課程時長
5. 建立 `coaches` 記錄 → 綁定教練版 Rich Menu

> `oa_url` 是必填欄位。學員端 Rich Menu 的「聯絡教練」按鈕靠它跳轉，漏了會導致學員在本系統的 OA 裡發問而無人回覆。

### 3.2 邀請學員

1. 教練點 Rich Menu「邀請學員」
2. **輸入學員名字**（例：小明）
3. 系統建立 `members`（`line_user_id` 為 null）+ `coach_members` + 一次性 `invites` token
4. 教練複製專屬連結，透過**他自己的官方帳號**傳給學員

> 邀請連結一次性且綁定特定學員記錄。好處：分母成立（可算已連結率）、防誤傳、且教練可在學員註冊前先幫他排課。

### 3.3 學員上線

1. 學員點連結 → LIFF 取得 userId
2. 未加好友 → 擋住並顯示「加入好友」
3. 一個輸入框，預填教練當初輸入的名字，提示「請填教練認得的名字」
4. 回填 `members.line_user_id`、標記 `invites.used_at` → 綁定學員版 Rich Menu

不收電話、email。收了只是隱私負債。

### 3.4 排課

手機 LIFF 上單一畫面完成，由上而下：選學員 → 選日期 → 選時間與時長 → 選重複週數。最上方另有可收合的月曆總覽（預設關閉），排課前可查現有課表。不做多步精靈——精靈每一步都要等頁面切換。底部固定列即時顯示「首堂時間 + 共幾堂」預覽與送出鈕。

學員選擇用**可搜尋的多選清單**（全螢幕覆蓋 + 搜尋框），不用橫排標籤：教練可能有數十位學員，標籤會爆版且找不到人。上限 3 位。

重複課程**展開成實體**：設定當下即依教練指定的週數生成 `sessions` 記錄，以 `series_id` 串聯。每筆獨立可改。

重複設定為單一下拉：**預設「單堂課程」**，或選「連續 2～12 週」。教練明確指定要排幾週，系列即在那時結束、**不自動延長**——因此不需要「每週往後補一週」的 cron。私教的排課視野通常很短，長期學員到期再重排即可。

生成規則：從所選日期當天開始，往後每 7 天一堂、共 N 堂。**不提供「選星期幾」**——讓使用者同時指定日期與星期幾時兩者必然會對不起來（例如在週三的日期上選「每週二」，系統該從哪天開始？），星期幾由所選日期決定才直觀。日曆運算走 UTC 整數天再轉台北時刻，避免伺服器時區影響日期判斷。

**修改整個系列的語義**：`scope=future` 指「這堂及同系列之後的每一堂」，且**只改每天幾點上課與時長，各堂日期維持不變**。教練說「以後都改成 20:00」是這個意思，不是把整串課往後推。要換星期幾請取消後重排。

**撞課偵測**：建立課程時比對教練自己既有的 `scheduled` 課程，有重疊則回 409 並列出衝突時段，由教練確認後帶 `force` 重送。不硬性阻擋——教練可能真的要排重疊的課。

### 3.5 請假

見 §6 狀態機。

---

## 4. 資料模型

```
coaches
  id                    uuid pk
  line_user_id          text unique not null
  name                  text not null
  oa_url                text not null        -- 教練自己官方帳號連結
  gym_id                uuid null            -- 預留 B2B，MVP 恆為 null
  leave_deadline_hours  int default 24       -- 請假自動核准門檻
  reminder_hours        int default 24       -- 課前提醒提前時數
  default_duration      int default 60
  ical_token            text unique not null -- iCal 訂閱用秘密 token
  created_at            timestamptz

members
  id                    uuid pk
  line_user_id          text unique null     -- null = 尚未完成註冊
  display_name          text not null
  line_blocked          bool default false   -- 推播失敗時標記
  created_at            timestamptz

coach_members
  coach_id              uuid fk
  member_id             uuid fk
  status                enum(active, inactive) default active
  display_name          text                 -- 這位教練對該學員的稱呼
  created_at            timestamptz
  primary key (coach_id, member_id)

coach_invites                              -- 教練邀請碼，由開發者以腳本產生
  token                 text pk
  label                 text                 -- 自用標記，辨識發給了誰
  expires_at            timestamptz
  used_at               timestamptz null
  coach_id              uuid null            -- 使用後回填，方便追溯
  created_at            timestamptz

invites                                    -- 學員邀請碼，綁定特定學員記錄
  token                 text pk
  coach_id              uuid fk
  member_id             uuid fk
  expires_at            timestamptz
  used_at               timestamptz null
  created_at            timestamptz

sessions
  id                    uuid pk
  coach_id              uuid fk
  series_id             uuid null            -- 同一組重複課程
  start_at              timestamptz not null
  duration_min          int not null
  location              text null            -- 選填自由文字（跨門店）
                                             -- MVP 的排課表單不提供此欄位，
                                             -- 欄位保留供日後啟用
  status                enum(scheduled, cancelled, completed)
  created_at            timestamptz

session_participants
  session_id            uuid fk
  member_id             uuid fk
  primary key (session_id, member_id)

leave_requests
  id                    uuid pk
  session_id            uuid fk
  member_id             uuid fk
  reason                text null
  status                enum(auto_approved, pending, approved, rejected)
  created_at            timestamptz
  resolved_at           timestamptz null

notifications
  id                    uuid pk
  target_line_user_id   text not null
  type                  text not null        -- 見 §5
  payload               jsonb
  send_at               timestamptz not null
  sent_at               timestamptz null
  status                enum(pending, sent, failed)
  error                 text null
  created_at            timestamptz
```

### 身分驗證規則

LIFF 前端傳來的 `userId` **一律不可信任**——那只是一段 JSON，任何人都能偽造後直接
呼叫 API 冒充他人。所有需要身分的 API 必須接收 `liff.getIDToken()` 的 ID token，
交由 `POST https://api.line.me/oauth2/v2.1/verify` 驗證（需帶 LINE Login channel ID
作為 `client_id`），以回傳的 `sub` 作為唯一可信的 userId。

### 資料模型規則

- **師生關係為多對多**。學員以 `line_user_id` 全域唯一，同一人被兩位教練邀請時共用同一筆 `members`，透過 `coach_members` 掛兩段關係。
- **隱私硬規則**：教練只能讀取 `coach_id` 等於自己的 `sessions`，以及自己 `coach_members` 中的學員。A 教練不得得知學員也在上 B 教練的課。所有查詢一律帶 `coach_id` 條件，無例外。
- **學員名字掛在關係上**：教練端顯示的名字一律讀 `coach_members.display_name`，不讀 `members.display_name`。同一學員可能屬於多位教練，共用名字會讓 A 教練取的稱呼洩漏給 B 教練，違反上一條隱私規則。`members.display_name` 僅用於學員端自己的畫面。
- **重複人員必須合併**：教練邀請學員時會先建立 `line_user_id` 為 null 的佔位記錄；若該 LINE 使用者其實已是別的教練的學員，註冊時必須把佔位記錄**合併**進既有記錄（搬移 `session_participants`、改指 `invites`、重建 `coach_members`），不可產生第二筆 `members`。
- **只停用、不刪除**。學員離開時 `coach_members.status = inactive`，歷史記錄保留。停用時詢問「是否同時取消未來的 N 堂課」，預設是。
- **時區**寫死 `Asia/Taipei`，全系統不做多時區。

---

## 5. 推播規則

| type | 對象 | 時機 | 內容 |
|---|---|---|---|
| `member_reminder` | 學員 | 課前 `coaches.reminder_hours`（預設 24） | 課程提醒 |
| `member_change` | 學員 | 即時 | 課程取消／改期 |
| `coach_leave` | 教練 | 即時 | 學員請假通知 |

### 實作規則

- 所有推播一律寫入 `notifications` 佇列，由 cron 每分鐘呼叫 `POST /api/cron/dispatch` 送出。**不在 request 內直接 push**（為了重試、稽核、防重複，也避免推播失敗連帶讓排課 API 失敗）。
- **先取走再送出**：派送時以條件更新把項目標記為 `sending` 並記下 `claimed_at`，兩次 cron 重疊時後者的更新會落空，不會重複推播。程序中斷而卡在 `sending` 超過 5 分鐘的項目下一輪回收重送。
- **失敗重試三次**後標記 `failed`，避免無效項目每分鐘重試不休。
- **推播回 403 視為學員已封鎖**，標記 `members.line_blocked` 讓教練端顯示警示。
- **內容於送出當下才產生**，不預先存文案。這樣課程改期後送出的仍是正確時間；課程若已取消則直接跳過不送。
- 「即時」= `send_at` 設為當下，下一分鐘的 cron 送出。
- 課程改期時，連同該 session 尚未送出的提醒一起移動 `send_at`；取消時刪除尚未送出的提醒（已送出的保留作為稽核紀錄）。這些都與課程異動在同一個 transaction 內完成，否則會出現「課排好了但沒人會被通知」。**不使用 delayed job 服務**（改期時要反查並取消 job 太麻煩）。
- **提醒時間已過就盡快送出**，而非略過。教練當天才排隔天以內的課是常態，學員仍然需要知道。
- 學員 `line_user_id` 為 null（尚未註冊）→ 不產生 notification，轉由 §8 降級流程處理。
- 推播 API 回傳錯誤（學員封鎖）→ 標記 `members.line_blocked = true`，教練端顯示警示。**這比從未連結更危險**，因為教練會誤以為學員收到了。
- 學員回覆訊息一律用 **reply message**（免費），不用 push。
- **不做每日彙總推播**。教練點 Rich Menu 的「今日課表」即可隨時查詢，走 reply message 免費且即時。改為推播的話每位教練每月多約 30 則、卻只是重複他自己按一下就看得到的東西。
- **異動即時通知**：課程取消或改期時立即排入 `member_change`。改期一定要同時附上舊時間，只說新時間學員不知道是哪一堂被動了。只有時間真的變動才通知——改地點或時長不值得吵學員。

### 成本估算

一個學員每週 2 堂 × 1 則 = 8 則／月，加上偶發的異動通知。20 學員的教練 ≈ 170 則／月 ≈ NT$34。取消每日彙總後，每位教練每月省下約 30 則。
100 個教練 ≈ 16,000 則／月 → 高用量方案 NT$1,200 + 10,000 × NT$0.2 = **約 NT$3,200／月**。

---

## 6. 請假狀態機

```
學員在 LIFF 點請假
        │
        ├─ 距上課 >= coaches.leave_deadline_hours (預設 24)
        │     → leave_requests.status = auto_approved
        │     → 移除該學員的 session_participants，刪掉他自己那則未送出的提醒
        │     → 若這堂課已無人剩下 → sessions.status = cancelled
        │     → 推播 coach_leave 通知教練（僅告知，不需處理）
        │
        └─ 距上課 < 門檻
              → leave_requests.status = pending
              → 推播 coach_leave 通知教練（需教練決定）
              → 教練批准 → approved，同上處理參與者，推播學員
              → 教練拒絕 → rejected，session 維持 scheduled，推播學員

**請假取消的是「該學員在該堂課的參與」，不是整堂課。** 一堂課最多 3 人，
小明請假時小華那堂課還是要上；只有當一堂課沒有人剩下時才整堂標記取消。
連帶只刪除請假者自己那則尚未送出的提醒，其他參與者的照舊。
```

**補課不做。** 請假即取消，教練需要補課就自己再排一堂新的。

設計理由：90% 的請假是提前的，那些應該零摩擦不打擾教練；只有真正需要判斷的臨時請假才升級成申請。

---

## 7. LINE 平台架構

```
LINE Provider（單一）
├── Messaging API channel  — webhook 接收、push 推播
└── LIFF app               — 所有使用者介面
```

**關鍵前提**：LIFF channel 與 Messaging API channel 必須位於**同一個 Provider**，否則取得的 userId 不一致，推播會失敗。此為不可逆的初始設定，建錯要重來。

### Rich Menu（三個，依角色個別綁定）

| 選單 | 對象 | 按鈕 |
|---|---|---|
| 未註冊 | 剛加好友尚未填資料 | 單一大按鈕「完成註冊」 |
| 教練版 | `coaches` 存在 | 今日課表｜我的課表｜排課／我的學員｜請假通知｜設定 |
| 學員版 | `members` 已連結 | 我的課表（postback）｜請假／聯絡教練｜個人設定 |

- 註冊完成時以 `POST /v2/bot/user/{userId}/richmenu` 個別綁定
- **查課表一律走 postback，不開 LIFF**：教練的「今日課表」與學員的「我的課表」
  都由 webhook 直接回一則文字訊息。查看課表是最高頻的動作，不該等網頁載入，
  而 reply message 免費、不佔推播額度。輸入「課表」等關鍵字也有同樣效果
- **Rich Menu ID 以名稱向 LINE 查詢**，不寫在環境變數裡。選單重建後 ID 會變，
  存在環境變數就得每次同步更新，漏更新會讓新註冊的人拿不到選單
- **邀請學員併入「我的學員」頁面**：邀請是管理學員的子動作，而選單只有六格，
  應留給每天都會用到的功能
- 學員版「聯絡教練」**不可寫死網址**：Rich Menu 全體共用，而學員可能同時屬於多位教練、
  每位教練的官方帳號不同。該按鈕導向 LIFF 的 `?p=contact` 頁面，由頁面依當前學員
  動態列出其教練的 `oa_url`
- Rich Menu 圖片由 `scripts/richmenu.ts` 以自繪 SVG 線條圖示產生後上傳。
  不使用 emoji：emoji 樣貌取決於系統字型，不同機器產出不一致
- **教練上手指引需提醒**：在他自己的 OA 設定自動回覆，引導「請假請點下方選單」。此事系統無法代勞。

### 介面

- **MVP 只做 LIFF 手機版**，但以響應式 CSS 撰寫
- 桌面入口共用同一套 React 元件，改用 LINE Login 網頁 OAuth（同一 channel，userId 一致），額外成本約 3-4h

---

## 8. 未連結學員的降級流程

學員加好友轉換率是本產品的生死線。系統必須讓教練在轉換率不完美時仍能運作：

1. 教練**可為尚未註冊的學員排課**（`members.line_user_id` 為 null 即可）
2. 學員列表顯示連結狀態，未連結者有「重新發送邀請」按鈕
3. LIFF 今日課表頁，未連結學員旁有「**複製通知文字**」按鈕，教練複製後貼到自己的 OA 傳送 — 降級但不歸零
4. **教練端首頁最顯眼處顯示「已連結 12／共 20」** — 既是北極星指標，也是推動教練去催學員的動力

---

## 9. Google Calendar 整合（iCal 唯讀訂閱）

**不做 OAuth 寫入。** Google Calendar 寫入權限屬敏感範圍，可能需通過 Google 應用程式驗證審核，那是數週流程，MVP 不碰。

**做法**：提供秘密網址 `https://{host}/api/calendar/{ical_token}.ics`，輸出 iCalendar 格式。教練在 Google 日曆「其他日曆 → 從網址新增」貼上一次，之後課表即與私人行程並排顯示。網址與操作步驟在教練端「設定」頁提供。

涵蓋往前 30 天到往後 180 天的未取消課程。取消的課直接不輸出，訂閱端下次更新時該事件即消失。內容行依 RFC 5545 折行，且以位元組計算——中文一字三個位元組，以字元計會折在字元中間造成亂碼。

- 實作成本約 2-3h（一個 API route 吐純文字）
- 已知限制：Google 拉取外部日曆頻率不保證，可能延遲數小時。**可接受** — 即時通知由 LINE 推播負責，GCal 僅供教練規劃整體行程。
- 唯讀，教練無法在 GCal 修改課程。iCal 事件說明欄需註明「修改請至排課系統」。

**設計理由**：教練的私人行程在 GCal，他不會為本系統放棄它。若不提供任何整合，教練將被迫維護「健身房系統 + GCal + 本系統」三份行程，這是產品死亡的典型路徑。

---

## 10. 技術棧

| 層 | 選型 |
|---|---|
| 框架 | Next.js（App Router）+ TypeScript |
| ORM | Prisma |
| 資料庫 | Postgres（Neon） |
| 部署 | Vercel |
| 排程 | 外部 cron 每分鐘打 API endpoint（Upstash QStash schedule 或 cron-job.org） |

LIFF 前端與 LINE webhook 後端置於同一專案。LIFF 硬性要求 HTTPS，Vercel 免設定。

Vercel Hobby 方案的內建 cron 僅支援每日一次，故排程走外部服務。

---

## 11. MVP 範圍

### 做

排課（單次 + 重複展開）、課前推播、異動推播、學員課表查詢、請假（含門檻自動核准）、邀請與綁定、iCal 訂閱、未連結降級、已連結率指標。

### 明確不做

堂數包／剩餘堂數扣抵、金流、補課、多層權限、健身房管理端、Google OAuth 雙向同步、團體課／小班、多時區、學員資料編輯、教練自助註冊、**訂閱制與營收報表**。

> 「健身房管理端」指賣給健身房的 B2B 介面，不含 §16 的開發者後台——後者只有開發者一個使用者，不是產品的一部分。
>
> **訂閱制不做的理由**：計費模型尚未定案（§14 仍在爭論按人頭或固定月費）。現在建 plan／subscription／invoice 表八成猜錯。但**推播用量這個事實要現在就記**，見 §16。

**堂數包不做的理由**：不是教練的痛點（他現在用 Excel 記得好好的）；牽涉到錢，算錯一次教練就永久不信任系統；預估吃掉 40h，等於兩週全部產能。

---

## 12. 開發順序

| # | 項目 | 估時 |
|---|---|---|
| 1 | 專案骨架、LINE channel／LIFF 設定、webhook、資料表 ✅ | 8h |
| 2 | 教練註冊 + Rich Menu 角色綁定 ✅ | 8h |
| 3 | 邀請學員 + 學員註冊 + 關聯建立 ✅ | 8h |
| 4 | **排課 UI**（單堂 + 連續 2～12 週） ✅ | 16h |
| 5 | 通知佇列 + cron + 課前提醒 ✅ | 8h |
| 6 | 學員課表 + 請假流程 ✅ | 10h |
| 7 | 請假審核 ✅（原含每日彙總，已取消，見 §5） | 6h |
| 8 | 異動即時推播 ✅ | 2h |
| 9 | iCal 訂閱 ✅ | 3h |
| 10 | 未連結降級 + 已連結率指標 | 4h |

**合計約 73h ≈ 4 週**（以 20h／週計）

> 第 7 項原本包含每日彙總推播，已依 §5 取消（改走免費的 reply）。`NotificationType.coach_daily` 是取消後殘留的 enum 值，沒有任何地方產生它，cron dispatch 也沒有對應分支。
> §16 後台的推播類型統計會固定顯示 0——**那個 0 是正確的**，代表這條每月每教練約 30 則的成本確實沒有發生。留著這個 enum 值只是因為 Postgres 移除 enum 值代價高，不值得為它動一次 migration。

第 1 項含需人工在 LINE Developers Console 與 Neon 完成的設定，另附設定指引。

---

## 13. 風險與指標

| 風險 | 監測方式 | 觸發行動 |
|---|---|---|
| 學員加好友轉換率過低 | 教練端「已連結／總數」彙總 | **低於 80%** 則評估改接教練自己的 OA（Messaging API），或做成混合模式 |
| 教練不真的進來排課 | 每週活躍排課教練數 | 產品生死線。排課 UI 需反覆打磨 |
| 教練被迫維護三份行程 | 訪談 | iCal 訂閱使用率低則需重新評估 |
| 健身房封殺外部工具 | 訪談 | 目前確認無明文規定 |

---

## 14. 待決事項

**定價**。目前構想為教練訂閱制、月費壓在 NT$100 以內。

開發者記錄的反對意見：每教練訊息成本約 NT$32-64，NT$100 售價毛利過薄，扣除金流手續費後接近歸零；且低價會傳達「廉價小工具」訊號，降低教練認真使用與轉介的意願。建議改為按學員數階梯（20 人內 299／50 人內 599／無上限 999），使成本與收費天然掛鉤。

此事延後至產品驗證後再議。前期熟人教練免費試用。

---

## 15. 決策記錄

| 決策 | 選擇 | 主要理由 |
|---|---|---|
| 重複課程 | 展開成實體 session | 私教例外多到 RRULE 優勢消失；推播／請假／同步皆針對具體課程，實體化後邏輯極簡 |
| OA 架構 | 單一共用 OA | 教練零設定門檻。代價是學員加好友轉換率風險，以 §8 降級流程與指標防守 |
| 課程人數 | 1:N（N≤3） | 實際有 1 對 2、1 對 3；1:1 只是 N=1 特例，事後改為 1:N 是全系統性改動 |
| 師生關係 | 多對多 | 連鎖健身房會員必然跨教練上課；一對多會被迫產生同人兩筆髒資料 |
| GCal | iCal 唯讀訂閱 | 2-3h vs OAuth 的數週驗證流程；即時性由 LINE 推播負責，GCal 延遲無感 |
| 請假 | 門檻自動核准 | 90% 請假是提前的，不該打擾教練；僅臨時請假升級為申請 |
| 異動推播 | 保留 | 「學員白跑一趟」的體感傷害大於「忘記來」；成本僅 +6%，工時僅 2h |
| 邀請連結 | 綁名字一次性 | 使「已連結率」分母成立、防誤傳、且允許為未註冊學員先排課 |
| 推播歸屬 | `notifications.coach_id` 落地欄位 | 「這則推播是誰造成的」是發生當下才知道的事實，晚一天加就永久少一天資料；靠 `session_id` 反推會在 SetNull 後斷掉 |
| 內容失效的推播 | 新增 `skipped` 狀態 | 原本標記為 `sent`，會讓計費用量虛高；LINE 只對真的送出去的訊息收費 |
| 後台身分驗證 | 單一密碼 + HMAC cookie | 只有開發者一個使用者。LINE Login 要另設 web callback，成本與收益不成比例 |

---

## 16. 管理後台（開發者）

### 定位

`baseUrl/admin`，單一密碼、單一權限、**只給開發者**。不是 §11「明確不做」清單裡的健身房管理端——那是賣給健身房的 B2B 介面，這裡只有一個使用者。

存在理由是 Prisma Studio 給不了的兩件事：**跨表聚合**（已連結率、活躍教練數、推播用量）與**產生教練邀請碼**這個高頻動作。Studio 仍保留，用於後台刻意不做的一次性維護（例如刪除發錯的邀請碼）。

### 隱私

後台**刻意不遵守 §4 的教練隱私隔離規則**：會顯示同一學員屬於哪些教練、學員的 LINE userId、請假理由原文、教練的 iCal token。

這是可接受的，因為使用者是系統維運者——他本來就能直接連資料庫查同樣的東西，在後台加一層遮蔽只是自欺。**但這條規則不得外溢**：教練端與學員端的任何查詢都不得重用 `src/lib/admin/queries.ts`。

### 身分驗證（三層）

| 層 | 位置 | 職責 |
|---|---|---|
| 1 | `src/proxy.ts` | 只看 cookie 在不在，沒有就導向 `/admin/login`。**不是安全邊界** |
| 2 | `requireAdmin()`（`src/lib/admin/session.ts`） | 驗 HMAC 簽章與到期。`React.cache()` 包住，同一次 render 只驗一次 |
| 3 | 每個 query／每個 Server Action 的第一行 | 呼叫 `requireAdmin()`。**這才是真正的門** |

不能只靠 layout 擋：layout 不會在每次導航都重跑，巢狀 segment 與 Server Action 都會繞過它。Server Action 編譯後是公開的 POST 端點——只要拿到 client bundle 裡的 action ID 就能直接呼叫，proxy 的 matcher 只是碰巧擋得住。

- 密碼比對 `crypto.timingSafeEqual`；cookie 值為 `<到期毫秒>.<HMAC-SHA256>`，`httpOnly` + `Secure` + `SameSite=Lax`，7 天。
- 環境變數 `ADMIN_PASSWORD`（≥16 字元）、`ADMIN_SESSION_SECRET`。
- **刻意不做登入失敗次數限制**，因此密碼長度是唯一的防線，必須隨機產生。

### 架構

資料一律由 RSC 直接查 DB，**不新增任何 `/api/admin/*`**：後台沒有 client 端需求，多一層 API 只是多一組要保護的端點。所有 query 明確 `select` 欄位——傳給 Client Component 的 props 會整包序列化進 RSC payload。

版面為側邊欄（第一版僅兩個項目，但預留後續功能）。不沿用 `src/app/liff/ui.tsx`：那是手機單欄元件，這裡是桌機寬表格。不引入圖表 library，唯一的長條圖以 div + CSS 高度手刻。

### 推播計費統計

「**計費推播**」的定義：`notifications.status = 'sent'`。

- 回覆訊息（Reply API）免費，且根本不進 `notifications` 表（§5）。
- `skipped`（取走後發現內容已失效，沒送出）與 `failed`（沒送成）都不計費。
- 歸屬靠 `notifications.coach_id`，排入佇列時寫死，不靠 `session_id` 反推。反推不到的舊資料留 `null`，後台單獨顯示為「未歸屬」，不猜、不硬塞給任何教練。

時間桶一律以 `sent_at` 切、台北時區：**昨天**（完整一日）、**過去 7 天**（7 個完整日，不含今天）、**本月**（自然月，1 日重算）、**總計**。

用自然月而非滾動 30 天，是因為 LINE 的免費額度按自然月重算，滾動窗口跟帳單永遠對不起來。**後台不顯示「剩餘免費額度」**——那取決於 OA 方案，寫死的數字某天會過期而沒人發現。

### 第一版範圍

| 路由 | 內容 |
|---|---|
| `/admin/login` | 單一密碼 |
| `/admin` | KPI 卡（教練／學員與已連結率／未來 7 天課程／推播失敗）、計費推播四桶、過去 14 天長條圖、推播類型佔比 |
| `/admin/coaches` | 教練列表（含每位教練的計費推播四桶），依「最後一次排課」倒序；產生教練邀請碼；邀請碼清單 |
| `/admin/coaches/[id]` | 設定／學員／課程（過去 30 天 + 未來，上限 200 筆）／請假紀錄 |

**刻意不做**：學員獨立頁面（學員的意義都在「他跟哪位教練上課」的脈絡裡）、推播佇列頁、撤銷邀請碼、代發學員邀請碼（那個連結必須由教練用自己的 OA 傳出，§3.2）、分頁。

`scripts/invite-coach.ts` 保留為逃生口（後台掛掉或密碼遺失時仍能發碼）。
