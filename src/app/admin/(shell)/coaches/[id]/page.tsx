import Link from "next/link";
import { notFound } from "next/navigation";
import { getCoachDetail } from "@/lib/admin/queries";
import { BUCKETS, BUCKET_LABELS } from "@/lib/admin/time-buckets";
import { fmtStamp, relativeTime } from "@/lib/admin/format";
import { fmtSession, fmtTimeRange } from "@/lib/time";
import { Badge, Card, Empty, PageHeader, Stamp, Stat, Table, Td, Th } from "../../../ui";

export const dynamic = "force-dynamic";

const SESSION_TONE = {
  scheduled: "good",
  cancelled: "bad",
  completed: "neutral",
} as const;

const SESSION_LABEL = {
  scheduled: "已排定",
  cancelled: "已取消",
  completed: "已完成",
} as const;

const LEAVE_LABEL: Record<string, string> = {
  auto_approved: "自動核准",
  pending: "待處理",
  approved: "已同意",
  rejected: "已拒絕",
};

const LEAVE_TONE: Record<string, "good" | "warn" | "bad" | "neutral"> = {
  auto_approved: "good",
  pending: "warn",
  approved: "good",
  rejected: "bad",
};

export default async function CoachDetailPage({ params }: PageProps<"/admin/coaches/[id]">) {
  const { id } = await params;
  const detail = await getCoachDetail(id);
  if (!detail) notFound();

  const { coach, members, sessions, leaves, billed } = detail;
  const now = new Date();
  const linked = members.filter((m) => m.lineUserId).length;

  return (
    <>
      <PageHeader
        title={coach.name}
        subtitle={`註冊於 ${fmtStamp(coach.createdAt)}（${relativeTime(coach.createdAt, now)}）`}
        action={
          <Link
            href="/admin/coaches"
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-50"
          >
            ← 教練列表
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-5">
        {BUCKETS.map((b) => (
          <Stat
            key={b}
            label={`計費推播·${BUCKET_LABELS[b]}`}
            value={billed[b]}
            unit="則"
            accent="amber"
          />
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card title="設定" className="xl:col-span-1">
          <dl className="divide-y divide-slate-100 text-sm">
            <Row label="請假自動核准門檻">{coach.leaveDeadlineHours} 小時</Row>
            <Row label="課前提醒提前">{coach.reminderHours} 小時</Row>
            <Row label="預設課程時長">{coach.defaultDuration} 分鐘</Row>
            <Row label="官方帳號">
              <a
                href={coach.oaUrl}
                target="_blank"
                rel="noreferrer"
                className="break-all text-blue-600 hover:underline"
              >
                {coach.oaUrl}
              </a>
            </Row>
            <Row label="LINE userId">
              <code className="text-xs break-all select-all">{coach.lineUserId}</code>
            </Row>
            <Row label="iCal token">
              <code className="text-xs break-all select-all">{coach.icalToken}</code>
            </Row>
          </dl>
        </Card>

        <Card
          title="學員"
          hint={`${members.length} 位，已連結 ${linked} 位`}
          className="xl:col-span-2"
        >
          {members.length === 0 ? (
            <Empty>這位教練還沒有學員。</Empty>
          ) : (
            <Table
              head={
                <tr>
                  <Th>教練給的稱呼</Th>
                  <Th>學員自填</Th>
                  <Th>狀態</Th>
                  <Th numeric>累計課數</Th>
                  <Th>加入</Th>
                </tr>
              }
            >
              {members.map((m) => (
                <tr key={m.memberId} className="hover:bg-slate-50">
                  <Td>
                    <span className="font-medium text-slate-900">{m.displayName}</span>
                  </Td>
                  <Td muted>{m.lineUserId ? m.selfName : "—"}</Td>
                  <Td>
                    <span className="flex flex-wrap gap-1.5">
                      {!m.lineUserId ? (
                        <Badge tone="warn">未完成註冊</Badge>
                      ) : (
                        <Badge tone="good">已連結</Badge>
                      )}
                      {m.lineBlocked ? <Badge tone="bad">已封鎖 OA</Badge> : null}
                      {m.status === "inactive" ? <Badge>已結束</Badge> : null}
                    </span>
                  </Td>
                  <Td numeric muted={m.sessionCount === 0}>
                    {m.sessionCount}
                  </Td>
                  <Td muted>{fmtStamp(m.createdAt)}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <Card
          title="課程"
          hint={
            detail.sessionsTruncated
              ? "過去 30 天 + 未來，已達 200 筆上限（更久遠的請用 Prisma Studio）"
              : "過去 30 天 + 未來全部"
          }
        >
          {sessions.length === 0 ? (
            <Empty>這段期間沒有課程。</Empty>
          ) : (
            <Table
              head={
                <tr>
                  <Th>時間</Th>
                  <Th>時段</Th>
                  <Th>學員</Th>
                  <Th>地點</Th>
                  <Th>狀態</Th>
                  <Th>重複</Th>
                </tr>
              }
            >
              {sessions.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <Td>
                    <span className="whitespace-nowrap">{fmtSession(s.startAt)}</span>
                  </Td>
                  <Td muted>{fmtTimeRange(s.startAt, s.durationMin)}</Td>
                  <Td>{s.participants.join("、") || "—"}</Td>
                  <Td muted>{s.location || "—"}</Td>
                  <Td>
                    <Badge
                      tone={SESSION_TONE[s.status as keyof typeof SESSION_TONE] ?? "neutral"}
                    >
                      {SESSION_LABEL[s.status as keyof typeof SESSION_LABEL] ?? s.status}
                    </Badge>
                  </Td>
                  <Td muted>{s.seriesId ? "系列課" : "單堂"}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <Card title="請假紀錄" hint="最近 100 筆">
          {leaves.length === 0 ? (
            <Empty>還沒有請假紀錄。</Empty>
          ) : (
            <Table
              head={
                <tr>
                  <Th>申請時間</Th>
                  <Th>學員</Th>
                  <Th>該堂課</Th>
                  <Th>狀態</Th>
                  <Th>原因</Th>
                </tr>
              }
            >
              {leaves.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50">
                  <Td>
                    <Stamp
                      absolute={fmtStamp(l.createdAt)}
                      relative={relativeTime(l.createdAt, now)}
                    />
                  </Td>
                  <Td>{l.memberName}</Td>
                  <Td muted>
                    <span className="whitespace-nowrap">{fmtSession(l.startAt)}</span>
                  </Td>
                  <Td>
                    <Badge tone={LEAVE_TONE[l.status] ?? "neutral"}>
                      {LEAVE_LABEL[l.status] ?? l.status}
                    </Badge>
                  </Td>
                  <Td muted>{l.reason || "—"}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4 px-5 py-2.5">
      <dt className="w-32 shrink-0 text-slate-500">{label}</dt>
      <dd className="min-w-0 flex-1 text-slate-800">{children}</dd>
    </div>
  );
}
