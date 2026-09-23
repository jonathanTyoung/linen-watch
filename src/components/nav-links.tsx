"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/queue", label: "Queue" },
  { href: "/specs", label: "Specs" },
  { href: "/orders", label: "Orders" },
  { href: "/settings", label: "Settings" },
];

export function NavLinks({ pendingCount }: { pendingCount: number }) {
  const pathname = usePathname();
  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto" aria-label="Main">
      {LINKS.map((l) => {
        const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={cx(
              "flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition",
              active ? "bg-surface text-ink shadow-[0_0_0_1px_var(--line)]" : "text-muted hover:text-ink",
            )}
          >
            {l.label}
            {l.href === "/queue" && pendingCount > 0 ? (
              <span className="tabular rounded-full bg-warn px-1.5 font-mono text-[10px] font-semibold text-bg">
                {pendingCount}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
