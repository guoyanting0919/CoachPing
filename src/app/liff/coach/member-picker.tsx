"use client";

import { useMemo, useState } from "react";

export type PickerMember = { id: string; name: string; linked: boolean };

/**
 * 可搜尋的學員多選。教練的學員可能有數十位，橫排標籤會爆版且找不到人，
 * 因此改成「已選標籤 + 全螢幕搜尋清單」。
 */
export default function MemberPicker({
  members,
  selected,
  onChange,
  max,
}: {
  members: PickerMember[];
  selected: string[];
  onChange: (ids: string[]) => void;
  max: number;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => m.name.toLowerCase().includes(q));
  }, [members, query]);

  function toggle(id: string) {
    if (selected.includes(id)) {
      onChange(selected.filter((x) => x !== id));
    } else if (selected.length < max) {
      onChange([...selected, id]);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setQuery("");
        }}
        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-left"
      >
        {selected.length === 0 ? (
          <span className="text-base text-slate-400">點此選擇學員</span>
        ) : (
          <span className="flex flex-wrap gap-1.5">
            {selected.map((id) => (
              <span
                key={id}
                className="rounded-full bg-[#06C755]/10 px-3 py-1 text-sm font-medium text-[#06C755]"
              >
                {byId.get(id)?.name ?? "?"}
              </span>
            ))}
          </span>
        )}
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-white">
          <div className="border-b border-slate-100 p-4">
            <div className="flex items-center gap-3">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜尋學員"
                className="min-w-0 flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-base outline-none focus:border-[#06C755]"
              />
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="shrink-0 text-sm font-semibold text-[#06C755]"
              >
                完成
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              已選 {selected.length}／{max} 位
            </p>
          </div>

          <div className="flex-1 overflow-y-auto overscroll-contain">
            {filtered.length === 0 ? (
              <p className="p-6 text-center text-sm text-slate-400">找不到符合的學員</p>
            ) : (
              filtered.map((m) => {
                const active = selected.includes(m.id);
                const full = !active && selected.length >= max;

                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggle(m.id)}
                    disabled={full}
                    className={`flex w-full items-center gap-3 border-b border-slate-50 px-5 py-3.5 text-left ${
                      full ? "opacity-40" : ""
                    }`}
                  >
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 ${
                        active ? "border-[#06C755] bg-[#06C755]" : "border-slate-300"
                      }`}
                    >
                      {active ? (
                        <svg viewBox="0 0 16 16" className="h-3 w-3 fill-none stroke-white stroke-[3]">
                          <path d="M3 8.5 L6.5 12 L13 4.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : null}
                    </span>

                    <span className="min-w-0 flex-1 truncate text-base text-slate-900">
                      {m.name}
                    </span>

                    {/* 未連結的學員收不到自動提醒，選之前就該知道。 */}
                    {!m.linked ? (
                      <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                        未加入
                      </span>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
