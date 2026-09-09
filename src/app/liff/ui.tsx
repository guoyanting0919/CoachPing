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
