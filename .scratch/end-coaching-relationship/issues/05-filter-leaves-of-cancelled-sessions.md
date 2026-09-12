# 05: 待辦請假要過濾掉已取消的課

**What to build:** `api/coach/leaves/route.ts` 只查 `status: "pending"` 與 `session.coachId`，
沒看課程狀態。課一旦被取消，那筆請假申請還是會留在教練的待辦清單裡，點進去才發現課不存在。

這是獨立於結束合作的既有缺陷——任何取消課程的路徑都會製造它，結束合作只是讓它更容易發生
（一次取消 8 堂課就可能一次留下好幾筆）。

`leave_requests` 的狀態**不要動**。歷史上他確實申請了、確實沒人決定，
改成 `rejected` 等於謊稱教練駁回了他，而且會觸發推播邏輯。

**Blocked by:** None (can start immediately)

**Status:** ready-for-human（實作完成）

- [x] `GET /api/coach/leaves` 只回 `session.status = scheduled` 的待辦請假
- [x] `leave_requests` 的資料完全不被修改
- [ ] 課取消後，教練的待辦數字跟著少

---

## 實作紀錄

`GET /api/coach/leaves` 加上 `session: { status: "scheduled" }`。

**同時補了驗收條件沒寫到的一處**：`POST /api/coach/leaves/[id]` 也只查 pending
而不看課程狀態。停留很久的待辦清單按下「駁回」，會推一則「這堂課仍照原定時間進行」
給學員——而那堂課已經不存在了。那支也加了同樣的條件。

`leave_requests` 的資料完全沒動。
