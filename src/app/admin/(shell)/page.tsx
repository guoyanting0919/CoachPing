import { NotificationType } from "@/generated/prisma/enums";
import { getDashboard } from "@/lib/admin/queries";
import { BUCKETS, BUCKET_LABELS } from "@/lib/admin/time-buckets";
import { pct } from "@/lib/admin/format";
import { BarChart, Card, PageHeader, Stat } from "../ui";

export const dynamic = "force-dynamic";

/**
 * 跑 enum 全集而不是查詢結果，沒有資料的類型也要顯示為 0。
 * coach_daily 是每日彙總取消後（SPEC.md §5）殘留的 enum 值，永遠是 0——
 * 那個 0 是正確的，代表每位教練每月約 30 則的推播成本確實沒有發生。
 */
const TYPE_LABELS: Record<NotificationType, string> = {
  member_reminder: "學員：課前提醒",
  member_change: "學員：課程異動",
  member_schedule: "學員：排課完成",
  coach_daily: "教練：每日課表",
  coach_leave: "教練：學員請假",
  coach_booking: "教練：學員預約",
};

export default async function DashboardPage() {
  const d = await getDashboard();

  return (
    <>
      <PageHeader
        title="儀表板"
        subtitle="推播用量一律以實際送出時間（sentAt）計算，時區為台北。"
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="教練"
          value={d.coaches.total}
          unit="位"
          note={`過去 7 天有排課：${d.coaches.activeLast7d} 位`}
          accent="blue"
        />
        <Stat
          label="學員"
          value={d.members.total}
          unit="位"
          note={`已連結 LINE：${d.members.linked} 位（${pct(d.members.linked, d.members.total)}）`}
          accent="teal"
        />
        <Stat
          label="未來 7 天課程"
          value={d.upcomingSessions7d}
          unit="堂"
          accent="slate"
        />
        <Stat
          label="推播失敗（過去 7 天）"
          value={d.failedLast7d}
          unit="則"
          note={d.failedLast7d > 0 ? "重試已用盡，這些學員沒收到通知" : "沒有失敗"}
          accent={d.failedLast7d > 0 ? "rose" : "slate"}
        />
      </div>

      <div className="mt-8">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">
          計費推播
          <span className="ml-2 text-xs font-normal text-slate-400">
            只計真的送到 LINE 的訊息；回覆訊息免費、內容失效未送出（skipped）與失敗（failed）都不計
          </span>
        </h2>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-5">
          {BUCKETS.map((b) => (
            <Stat
              key={b}
              label={BUCKET_LABELS[b]}
              value={d.billed[b]}
              unit="則"
              note={
                b === "today"
                  ? "進行中，到今晚午夜為止"
                  : b === "month"
                    ? "自然月，1 日重算"
                    : undefined
              }
              accent="amber"
            />
          ))}
        </div>

        <p className="mt-2 text-xs text-slate-400">
          免費額度依你的 LINE 官方帳號方案而定，這裡刻意不顯示——寫死的額度某天會過期而沒人發現。請自行對照 LINE 後台。
          {d.unattributedTotal > 0
            ? ` 另有 ${d.unattributedTotal} 則未歸屬到教練（舊資料回填不到），已計入總計。`
            : ""}
        </p>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card
          title="每日計費推播"
          hint="過去 14 天"
          className="xl:col-span-2"
        >
          <BarChart data={d.daily} emptyLabel="過去 14 天沒有送出任何推播" />
        </Card>

        <Card title="推播類型佔比" hint="累計">
          <ul className="divide-y divide-slate-100">
            {Object.values(NotificationType).map((type) => {
              const count = d.byType.find((t) => t.type === type)?.count ?? 0;
              return (
                <li
                  key={type}
                  className="flex items-baseline justify-between px-5 py-3 text-sm"
                >
                  <span className={count === 0 ? "text-slate-400" : "text-slate-600"}>
                    {TYPE_LABELS[type]}
                  </span>
                  <span className="font-medium text-slate-900 tabular-nums">{count}</span>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </>
  );
}
