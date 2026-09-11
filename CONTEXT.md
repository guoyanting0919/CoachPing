# CoachPing

健身教練排課推播系統。教練在 LINE 裡排課，學員在 LINE 裡收提醒與請假。

## Language

### 身分

**教練**：
`coaches` 的一筆記錄，以 `line_user_id` 識別。可排課、管理學員、核准請假。
_Avoid_: 老師、trainer

**學員**：
`members` 的一筆記錄，以 `line_user_id` 識別。同一人被多位教練邀請時共用同一筆記錄。
_Avoid_: 會員、客戶、student

**雙重身分**：
同一個 LINE 使用者在 `coaches` 與 `members` 各有一筆記錄——亦即某位教練同時是**另一位**教練的學員。
不含「教練當自己的學員」，那不是本系統支援的情境。
_Avoid_: 多重角色、dual role、身兼兩角

**教練模式／學員模式**：
雙重身分者所處的介面狀態。兩套介面各自完整、互不混合，由 Rich Menu 決定當下在哪一邊。
_Avoid_: 視角、view、切換帳號

**未連結學員**：
`line_user_id` 為 `null` 的 `members` 記錄。教練已為其排課，但本人尚未透過邀請連結完成註冊，因此無法推播。
_Avoid_: 佔位學員、未註冊學員

### 關係與課程

**師生關係**：
`coach_members` 的一筆記錄。多對多：一位學員可屬於多位教練。教練端顯示的稱呼一律讀這裡的 `display_name`。
_Avoid_: 綁定、連結、membership

**課**：
`sessions` 的一筆記錄，一堂具體的、有明確開始時間的課。重複課程一律展開成多筆實體課，以 `series_id` 串聯。
_Avoid_: 課程、堂、預約、booking

**降級流程**：
推播對象是未連結學員時改由教練手動通知的替代路徑。
_Avoid_: fallback、備援
