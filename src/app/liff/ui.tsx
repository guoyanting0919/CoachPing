"use client";

/** LIFF 內共用的版面元件。手機優先，最大寬度限制讓桌面版也不會太醜。 */

export function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-slate-50">
      <div className="mx-auto w-full max-w-md px-5 py-8">{children}</div>
    </div>
  );
}

export function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md text-center">{children}</div>
    </div>
  );
}

export function Title({ children }: { children: React.ReactNode }) {
  return <h1 className="text-xl font-bold text-slate-900">{children}</h1>;
}

export function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-sm leading-relaxed text-slate-500">{children}</p>;
}

export function Button({
  children,
  onClick,
  disabled,
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded-xl bg-[#06C755] px-4 py-3.5 text-base font-semibold text-white transition active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-300"
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {hint ? <span className="mt-0.5 block text-xs text-slate-400">{hint}</span> : null}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

const controlClass =
  "w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-base text-slate-900 outline-none focus:border-[#06C755] focus:ring-2 focus:ring-[#06C755]/20";

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={controlClass} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={controlClass} />;
}

export function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {children}
    </div>
  );
}

/** 可切換的圓角標籤。用於選學員、選星期，點擊面積要夠大。 */
export function Chip({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-full px-4 py-2 text-sm font-medium transition ${
        active
          ? "bg-[#06C755] text-white"
          : disabled
            ? "bg-slate-100 text-slate-300"
            : "bg-white text-slate-700 ring-1 ring-slate-200"
      }`}
    >
      {children}
    </button>
  );
}

export function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
      {hint ? <p className="mt-0.5 text-xs text-slate-400">{hint}</p> : null}
      <div className="mt-2">{children}</div>
    </section>
  );
}

export function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl bg-white p-4 shadow-sm">{children}</div>;
}

/** 00:00–23:30，每 30 分鐘一格。 */
const HALF_HOURS = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, "0");
  return `${h}:${i % 2 ? "30" : "00"}`;
});

/**
 * 單一下拉的時刻選擇，每 30 分鐘一格。
 *
 * 與下面的 TimeSelect（時／分兩段式）刻意不同：一列要放「起–迄」兩個時刻時，
 * 兩段式會變成四個下拉，在 375px 寬的螢幕上必然撐出橫向捲軸。
 * 可預約時段與封鎖時段的邊界實務上都落在整點或半點，少掉的解析度沒有代價；
 * 排課的「幾點上課」仍用 TimeSelect，那裡一列只有一個時刻。
 *
 * 用 flex-1 + min-w-0 而非固定寬度：兩個並排時各自收縮到容器裝得下，
 * 不論螢幕多窄都不會溢出。
 */
export function HalfHourSelect({
  value,
  onChange,
  endOfDay = false,
}: {
  value: string;
  onChange: (v: string) => void;
  /** 迄時用：拿掉 00:00、補上 24:00，讓「開放到午夜」表達得出來。 */
  endOfDay?: boolean;
}) {
  const options = endOfDay ? [...HALF_HOURS.slice(1), "24:00"] : HALF_HOURS;

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white py-3 pl-3 pr-1 text-base text-slate-900 outline-none focus:border-[#06C755]"
    >
      {options.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </select>
  );
}

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
/** 私教排課都落在整點或半點，開放到分鐘只會讓教練多滑很久。 */
const MINUTES = ["00", "30"];

/**
 * 時／分兩段式選擇。
 * 刻意不共用 controlClass：那裡帶 w-full，放進 flex 容器會被旁邊的元素
 * 擠成只剩箭頭。這裡改用內容寬度並禁止收縮。
 */
const timeSelectClass =
  "min-w-[5rem] shrink-0 rounded-xl border border-slate-200 bg-white py-3 pl-4 pr-2 text-base text-slate-900 outline-none focus:border-[#06C755]";

export function TimeSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [hh = "19", mm = "00"] = value.split(":");

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <select
        value={hh}
        onChange={(e) => onChange(`${e.target.value}:${mm}`)}
        className={timeSelectClass}
      >
        {HOURS.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
      <span className="text-slate-400">:</span>
      <select
        value={mm}
        onChange={(e) => onChange(`${hh}:${e.target.value}`)}
        className={timeSelectClass}
      >
        {MINUTES.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </div>
  );
}
