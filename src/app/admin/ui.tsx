/**
 * 後台專用的版面元件（SPEC.md §16）。
 *
 * 刻意不沿用 src/app/liff/ui.tsx：那組是手機單欄 LIFF 的元件，
 * 這裡是桌機寬表格，硬共用只會逼出一堆 variant prop，兩邊都變難改。
 * 全部是 Server Component，沒有一行 "use client"。
 */

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Card({
  title,
  hint,
  children,
  className = "",
}: {
  title?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${className}`}
    >
      {title ? (
        <header className="flex items-baseline gap-3 border-b border-slate-100 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {hint ? <span className="text-xs text-slate-400">{hint}</span> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

const ACCENTS = {
  slate: "border-l-slate-400",
  blue: "border-l-blue-500",
  teal: "border-l-teal-500",
  amber: "border-l-amber-500",
  rose: "border-l-rose-500",
} as const;

export function Stat({
  label,
  value,
  unit,
  note,
  accent = "slate",
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  note?: string;
  accent?: keyof typeof ACCENTS;
}) {
  return (
    <div
      className={`rounded-lg border border-l-4 border-slate-200 bg-white px-5 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${ACCENTS[accent]}`}
    >
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-2 flex items-baseline gap-1.5">
        <span className="text-3xl font-semibold tracking-tight text-slate-900 tabular-nums">
          {value}
        </span>
        {unit ? <span className="text-sm text-slate-400">{unit}</span> : null}
      </p>
      {note ? <p className="mt-1.5 text-xs text-slate-400">{note}</p> : null}
    </div>
  );
}

export function Table({
  head,
  children,
}: {
  head: React.ReactNode;
  children: React.ReactNode;
}) {
  // 寬表格自己橫向捲，不讓整個頁面出現水平捲軸。
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max text-sm">
        <thead className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
          {head}
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}

export function Th({
  children,
  numeric = false,
}: {
  children: React.ReactNode;
  numeric?: boolean;
}) {
  return (
    <th className={`px-5 py-3 font-medium ${numeric ? "text-right" : ""}`}>{children}</th>
  );
}

export function Td({
  children,
  numeric = false,
  muted = false,
  className = "",
}: {
  children: React.ReactNode;
  numeric?: boolean;
  muted?: boolean;
  className?: string;
}) {
  return (
    <td
      className={`px-5 py-3 ${numeric ? "text-right tabular-nums" : ""} ${
        muted ? "text-slate-400" : "text-slate-700"
      } ${className}`}
    >
      {children}
    </td>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-5 py-8 text-center text-sm text-slate-400">{children}</p>;
}

const TONES = {
  neutral: "bg-slate-100 text-slate-600",
  good: "bg-teal-50 text-teal-700",
  warn: "bg-amber-50 text-amber-700",
  bad: "bg-rose-50 text-rose-700",
} as const;

export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: keyof typeof TONES;
}) {
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/** 絕對時間為主，相對時間為輔。 */
export function Stamp({ absolute, relative }: { absolute: string; relative: string }) {
  return (
    <span className="whitespace-nowrap">
      <span className="tabular-nums">{absolute}</span>
      <span className="ml-2 text-xs text-slate-400">{relative}</span>
    </span>
  );
}

/**
 * 手刻長條圖。純 div + 高度百分比，約 30 行。
 * 只有一種圖，為它引入 recharts（~100KB 加整片 "use client"）不划算。
 */
export function BarChart({
  data,
  emptyLabel = "尚無資料",
}: {
  data: { day: string; count: number }[];
  emptyLabel?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.count));
  if (data.every((d) => d.count === 0)) {
    return <Empty>{emptyLabel}</Empty>;
  }

  return (
    <div className="px-5 py-4">
      <div className="flex h-40 items-end gap-1.5">
        {data.map((d) => (
          <div key={d.day} className="group flex flex-1 flex-col items-center gap-1">
            <span className="text-[10px] text-slate-400 tabular-nums">
              {d.count > 0 ? d.count : ""}
            </span>
            <div
              className="w-full rounded-t bg-blue-500/85 transition group-hover:bg-blue-600"
              style={{ height: `${Math.max(2, (d.count / max) * 100)}%` }}
              title={`${d.day}：${d.count} 則`}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-1.5">
        {data.map((d) => (
          <span
            key={d.day}
            className="flex-1 text-center text-[10px] whitespace-nowrap text-slate-400 tabular-nums"
          >
            {d.day.slice(5).replace("-", "/")}
          </span>
        ))}
      </div>
    </div>
  );
}
