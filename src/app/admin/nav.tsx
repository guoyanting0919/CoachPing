"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * 側邊欄導航。第一版只有兩個項目，但版型先做成側邊欄——
 * 後續功能會一路往下加，屆時不用重排整個版面。
 */

const ITEMS = [
  { href: "/admin", label: "儀表板", exact: true },
  { href: "/admin/coaches", label: "教練管理", exact: false },
];

export default function Nav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-0.5 px-3">
      {ITEMS.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-md px-3 py-2 text-sm transition ${
              active
                ? "bg-white/10 font-medium text-white"
                : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
