import Link from "next/link";
import { listCoachInvites, listCoaches } from "@/lib/admin/queries";
import { BUCKETS, BUCKET_LABELS } from "@/lib/admin/time-buckets";
import { fmtStamp, relativeTime } from "@/lib/admin/format";
import { Badge, Card, Empty, PageHeader, Stamp, Table, Td, Th } from "../../ui";
import InviteForm from "./invite-form";

export const dynamic = "force-dynamic";

export default async function CoachesPage() {
  const [coaches, invites] = await Promise.all([listCoaches(), listCoachInvites()]);
  const now = new Date();

  return (
    <>
      <PageHeader
        title="教練管理"
        subtitle="預設依「最後一次排課」排序，久未排課的沉在最下方。"
      />

      <Card title="教練" hint={`${coaches.length} 位`}>
        {coaches.length === 0 ? (
          <Empty>還沒有教練。用下方的邀請連結把第一位教練請進來。</Empty>
        ) : (
          <Table
            head={
              <tr>
                <Th>教練</Th>
                <Th numeric>學員</Th>
                <Th numeric>未來 7 天課數</Th>
                {BUCKETS.map((b) => (
                  <Th key={b} numeric>
                    推播·{BUCKET_LABELS[b]}
                  </Th>
                ))}
                <Th>最後一次排課</Th>
                <Th>註冊</Th>
              </tr>
            }
          >
            {coaches.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <Td>
                  <Link
                    href={`/admin/coaches/${c.id}`}
                    className="font-medium text-slate-900 hover:text-blue-600 hover:underline"
                  >
                    {c.name}
                  </Link>
                </Td>
                <Td numeric>{c.memberCount}</Td>
                <Td numeric muted={c.upcoming7d === 0}>
                  {c.upcoming7d}
                </Td>
                {BUCKETS.map((b) => (
                  <Td key={b} numeric muted={c.billed[b] === 0}>
                    {c.billed[b]}
                  </Td>
                ))}
                <Td>
                  {c.lastScheduledAt ? (
                    <Stamp
                      absolute={fmtStamp(c.lastScheduledAt)}
                      relative={relativeTime(c.lastScheduledAt, now)}
                    />
                  ) : (
                    <Badge tone="warn">從未排課</Badge>
                  )}
                </Td>
                <Td muted>{fmtStamp(c.createdAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card title="新增教練" hint="產生一次性邀請連結">
          <InviteForm />
        </Card>

        <Card title="尚未使用的邀請碼" hint={`${invites.pending.length} 組`}>
          {invites.pending.length === 0 ? (
            <Empty>沒有待使用的邀請碼。</Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {invites.pending.map((i) => (
                <li key={i.token} className="px-5 py-3 text-sm">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium text-slate-900">{i.label}</span>
                    {i.expired ? (
                      <Badge tone="bad">已過期</Badge>
                    ) : (
                      <span className="text-xs text-slate-400">
                        {fmtStamp(i.expiresAt)} 到期
                      </span>
                    )}
                  </div>
                  {/* 顯示完整 LIFF 連結而非裸 token——這串是要直接貼給教練的。
                      select-all 讓點一下就整串選起來，不必自己拖曳。
                      不做撤銷：碼是一次性且會過期，發錯了重發一組就好。 */}
                  <code
                    className={`mt-1.5 block rounded border px-2 py-1.5 text-xs break-all select-all ${
                      i.expired
                        ? "border-slate-200 bg-slate-50 text-slate-400 line-through"
                        : "border-slate-200 bg-slate-50 text-slate-600"
                    }`}
                  >
                    {i.url}
                  </code>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <Card title="已使用的邀請碼" hint={`最近 ${invites.used.length} 組`}>
          {invites.used.length === 0 ? (
            <Empty>還沒有邀請碼被使用。</Empty>
          ) : (
            <Table
              head={
                <tr>
                  <Th>標記</Th>
                  <Th>使用時間</Th>
                  <Th>成為</Th>
                </tr>
              }
            >
              {invites.used.map((i) => (
                <tr key={i.token}>
                  <Td>{i.label}</Td>
                  <Td>
                    <Stamp
                      absolute={fmtStamp(i.usedAt)}
                      relative={relativeTime(i.usedAt, now)}
                    />
                  </Td>
                  <Td>
                    {i.coachId ? (
                      <Link
                        href={`/admin/coaches/${i.coachId}`}
                        className="text-blue-600 hover:underline"
                      >
                        {i.coachName ?? i.coachId}
                      </Link>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
