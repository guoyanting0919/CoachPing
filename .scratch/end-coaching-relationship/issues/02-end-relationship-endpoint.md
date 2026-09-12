# 02: 結束合作的後端

**What to build:** 教練把一段師生關係轉為 `inactive`，並收拾掉它留下的尾巴——未來的課、
待送的提醒、還沒用掉的邀請連結。

`PATCH /api/coach/members/[id]`（目前只有 `[id]/reinvite`，這支要新建），
body 帶「是否同時取消未來的課」。權限照既有規矩：一律以 `coachId` 為條件，
不得碰到別的教練的關係。

關係轉 `inactive` 之後，學員約不到課、教練排不了課——這兩道防線已經存在於
`api/member/booking/route.ts` 與 `api/coach/sessions/route.ts`，這張票不新增權限邏輯。

多人課不可整堂取消，見驗收條件。推播只送一則彙總，理由見 spec。

**Blocked by:** None (can start immediately)

**Status:** ready-for-human（實作完成，待 db:push 與真機驗收）

- [ ] `coach_members` 新增 `ended_at`（nullable），結束時落地
- [ ] 關係轉 `inactive`；歷史課程、`leave_requests`、已送出的通知一律不動
- [x] 選擇取消未來的課時，只動 `startAt >= now` 且 `status = scheduled` 的課
- [x] 多人課只移除這位學員的 `session_participants`；沒有參與者剩下時才 `status = cancelled`
- [x] 被取消的課，未送出的 `member_reminder` 一併作廢（重用 `cancelPendingNotifications`）
- [ ] 學員只收到**一則**彙總推播，列出被取消的課；不提關係結束
- [x] 彙總推播用 `member_change` 的新 `kind`，payload 帶 `sessionIds`，不新增 `NotificationType` enum 值
- [x] 未連結學員（`lineUserId` 為 null）不排任何推播，API 回傳足以讓前端顯示降級提示的資訊
- [x] 該關係底下 `usedAt` 為 null 的 `invite` 一併作廢——否則學員點舊連結會讓關係默默復活
- [x] 全部寫在一個 transaction 裡
- [x] 對已經是 `inactive` 的關係重複呼叫是安全的（不重複取消、不重複推播）

---

## 實作紀錄

`PATCH /api/coach/members/[id]`，`action: "end" | "restore"` 走同一支（恢復見 03）。
關係查詢擺在交易外、照 reinvite 那支的寫法——單一教練按一顆按鈕，不值得為競態多付一次鎖。

**「把學員移出一堂課」這條規則不是新寫的**，而是把 `applyApprovedLeave` 的本體抽成
`removeParticipant`，請假核准改成一行委派。兩邊本來就該是同一條規則（只刪他自己那則
未送出的提醒、沒人剩下才整堂取消），抽出來之後不會再各自漂移。逐堂呼叫而非整批 update，
多人課才不會連帶取消無關第三人的課。

彙總推播是 `enqueueSessionsCancelledDigest`：一則 `member_change`、`kind`
為 `cancelled_digest`、課程清單走 `payload.sessionIds`（與 `coach_booking` 同一種寫法），
**`sessionId` 欄位刻意留 null**——它不屬於任何單一課程，掛上其中一堂會被
`cancelPendingNotifications` 之類按 `sessionId` 的操作誤傷。`renderMemberChange`
加一個分支，一堂與多堂的文案分開（「這堂課」vs「以上 N 堂課」）。
`NotificationType` enum 沒動。

推播用 `flushNotifications()` 立刻送，不等 cron——學員的課表剛少了好幾堂。

重複呼叫安全：關係已是 `inactive` 就直接回 `ok`，不再取消課、不再推播。

**已驗證**：`npm run db:push` 跑過，`ended_at` 在資料庫裡讀得到（`scripts/check-relationship.ts`，
唯讀）。同一支腳本確認了帶關聯過濾的 `groupBy`（確認畫面那個 N）Prisma 接得住——
現有資料裡有一位學員未來有 12 堂課，逐堂推播的話那就是 12 則 LINE 訊息。

**未驗證**：結束合作的實際寫入與推播都還沒走過，真機也沒有。
