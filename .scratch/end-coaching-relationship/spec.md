# 結束合作

教練需要一個「把學員移出名單」的動作。**不叫刪除**——什麼都不刪。

## 名稱

**結束合作**（badge：已結束；反向動作：恢復合作）。

資料層維持 `coach_members.status = inactive` 不動（改 enum 要 migration，不值得）。
「停用」這個舊詞從 `SPEC.md §4`、`ADR-0001`、admin 後台 badge 一併換掉——一個概念兩個詞
是日後誤解的源頭。術語已寫入 `CONTEXT.md`。

不寫新 ADR：這裡的每個決定都容易改，不符合「難以逆轉」的門檻。

## 語義

- 只有教練能發動。學員不能自己離開教練——學員端沒有「管理我的教練」介面，而學員單方面
  消失、教練不知原因比現況更糟。
- `status` 轉 `inactive` 後，學員不能再向這位教練預約、教練不能再為他排課。
  **這兩道防線已經存在**（`api/member/booking/route.ts` 與 `api/coach/sessions/route.ts`
  都帶 `status: "active"`），本功能不新增任何權限邏輯。
- 可逆。關係與歷史全部保留。

## 未來的課

確認畫面列出後果，附一個預設勾選的「同時取消未來 N 堂課」；未來 0 堂課時不顯示該勾選框。

多人課（1 對 2、1 對 3）沿用 `SPEC.md §6` 請假的做法：只移除這位學員的
`session_participants`，**只有在沒人剩下時**才 `sessions.status = cancelled`。
整堂取消會連帶通知無關的第三人，那不是教練的意思。

## 推播

不為「關係結束」本身推播任何訊息。教練會當面或私訊講，系統替他宣告分手只會尷尬；
`ADR-0001` 已立過同一原則——這個動作不該有副作用去動對方的 LINE 介面。
學員的感受是教練從「聯絡教練」清單消失（該 API 已過濾 `active`）。

取消 N 堂課只送**一則彙總**。現行 `enqueueSessionChange` 是逐堂逐人各一則，
一次取消 8 堂課就是 8 則 LINE 訊息——既像騷擾，也照則數計進教練的推播用量（`SPEC.md §16`）。
做法是 `member_change` 新增一種 `kind`，payload 帶 `sessionIds: string[]`
（`coach_booking` 已有同樣的寫法），不新增 `NotificationType` enum 值。
文案只講哪幾堂課取消了，不提關係結束。

未連結學員沒有 `lineUserId` 可推，走 `SPEC.md §8` 的降級流程：完成後提示教練自己告知。

## 可逆

`coach_members` 新增 `ended_at`，恢復時清回 `null`。沒有它，「已結束」清單排不出先後，
教練分不出哪些是三個月前的舊帳。不用 `updatedAt`：改一次稱呼就沖掉了結束時間的語義。

- 教練端學員清單分「進行中／已結束」兩個分頁，`GET /api/coach/members` 一次回兩組。
- 「已連結 X／共 Y」指標只算進行中的關係。把舊帳算進分母會永遠清不到 100%，指標就廢了。
- 恢復只恢復關係，不復活當初取消的課。取消那刻已經推播告知學員課沒了，復活等於再推一次
  「其實還有」，而那些時段可能已經被別人約走。
- 未連結學員恢復時自動產生新邀請連結（結束時已作廢舊的）。

## 順帶收掉的兩個現有缺陷

1. **未使用的邀請會讓關係自己復活**：`api/member/register/route.ts` 的 upsert 寫死
   `update: { displayName: name, status: "active" }`。結束合作後若那張邀請還活著，
   學員點下去關係會默默復活，連教練取的稱呼都被覆寫。結束時一併作廢該關係底下
   `usedAt` 為 null 的 invite。保留 register 那段 `status: "active"`——它正是
   「被結束過的學員重新加入」這條路徑。
2. **待辦請假不看課程狀態**：`api/coach/leaves/route.ts` 只查 `status: "pending"`
   與 `session.coachId`。課被取消後那筆申請還卡在教練待辦裡，點進去會發現課不存在。
   加上 `session.status = scheduled`。

## UI

沿用 `liff/coach/session-actions.tsx` 的原地 `Mode` 狀態機：點學員卡片展開 menu，
選「結束合作」後進確認畫面。不用 `window.confirm`（裝不下勾選框，風格也不一致），
也不要求打字輸入學員名字（這是可逆動作，不該把成本加在每次正常使用上）。

恢復合作只要一顆確認鍵，不需勾選框——它不動到任何一堂課。

admin 後台不提供這個操作，只改 badge 文字。
