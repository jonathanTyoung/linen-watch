"use client";

import { useTransition } from "react";
import { switchUser } from "@/app/actions";
import { PEOPLE, type Person } from "@/lib/catalog";
import { cx } from "./ui";

/** Who's using the app right now. Approvals and edits are credited to them. */
export function UserSwitcher({ current }: { current: Person }) {
  const [pending, startTransition] = useTransition();
  return (
    <div
      className={cx("flex items-center rounded-full border border-line bg-surface p-0.5", pending && "opacity-70")}
      role="group"
      aria-label="Signed in as"
    >
      {(Object.keys(PEOPLE) as Person[]).map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => startTransition(() => switchUser(p))}
          aria-pressed={current === p}
          className={cx(
            "flex items-center gap-1.5 rounded-full py-1 pl-1 pr-2.5 text-xs font-semibold transition",
            current === p ? "bg-accent text-accent-ink" : "text-muted hover:text-ink",
          )}
        >
          <span
            className={cx(
              "flex h-5 w-5 items-center justify-center rounded-full text-[10px]",
              current === p ? "bg-accent-ink/20" : "bg-surface-2",
            )}
          >
            {PEOPLE[p][0]}
          </span>
          {PEOPLE[p]}
        </button>
      ))}
    </div>
  );
}
