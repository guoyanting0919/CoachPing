# 01: 把「停用」改名為「結束合作」

**What to build:** 一個概念現在有兩個詞。`CONTEXT.md` 已收錄「結束合作」，其餘三處的「停用」要跟上。

資料層的 `CoachMemberStatus.inactive` **不動**——改 enum 要一次 migration，換不到任何東西。
改的是人看得到的字與文件裡的敘述。

詳見 `.scratch/end-coaching-relationship/spec.md`。

**Blocked by:** None (can start immediately)

**Status:** ready-for-human（實作完成）

- [x] `SPEC.md §4` 的「只停用、不刪除」改寫為結束合作的措辭，並補上本功能的語義（可逆、只有教練能發動）
- [x] `ADR-0001` 第 40–41 行的「停用」改為「結束合作」，論點不變
- [x] admin 後台 `coaches/[id]/page.tsx` 的 badge 由「已停用」改為「已結束」
- [x] 全repo 搜不到殘留的「停用學員」字樣（`封鎖時段`、cron/Neon 那段的「停用」是別的意思，不要動）

---

## 實作紀錄

改了四處加兩處沒列進驗收條件的註解：`api/member/booking/route.ts` 與
`api/coach/sessions/[id]/route.ts` 裡引用「只停用不刪除」的註解，以及
`liff/coach/schedule-form.tsx` 的 `member_not_found` 錯誤文案（教練看得到的字）。

刻意留著的「停用」：`SPEC.md §3.6` 前端把重疊候選格「停用」、`booking/route.ts:89`
的「0 時前端停用所有格子」、`SPEC.md §17` 與 `SETUP.md` 的 Neon 算力耗盡被「停用」——
那三個是別的意思，換掉反而失真。

`SPEC.md §4` 那條順便補上本功能的完整語義（可逆、只有教練能發動、兩邊防線都靠
`status = active`），因為 schema 的註解會指回這一節。
