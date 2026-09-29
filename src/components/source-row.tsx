"use client";

import { useState, useTransition } from "react";
import { toggleSource } from "@/app/actions";
import type { Source } from "@/db/schema";
import { Pill, cx } from "./ui";

function Switch({
  on,
  disabled,
  onClick,
  label,
}: {
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "relative h-6 w-11 shrink-0 rounded-full border transition disabled:cursor-not-allowed disabled:opacity-40",
        on ? "border-accent bg-accent-soft" : "border-line bg-surface-2",
      )}
    >
      <span
        className={cx(
          "absolute top-0.5 left-0.5 h-[18px] w-[18px] rounded-full transition-transform",
          on ? "translate-x-5 bg-accent" : "bg-muted",
        )}
      />
    </button>
  );
}

export function SourceRow({
  source,
}: {
  /** `status` says whether scans will actually use this source, and if not, why. */
  source: Source & { status: { active: true } | { active: false; reason: string } };
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const api = source.purchaseMethod === "api";

  const flip = (field: "enabled" | "autoBuyAllowed") =>
    startTransition(async () => {
      const r = await toggleSource(source.id, field);
      setError(r.ok ? null : r.message);
    });

  return (
    <li className={cx("flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between", pending && "opacity-70")}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{source.name}</span>
          <Pill tone={api ? "accent" : "neutral"}>{api ? "Orders via API" : "Manual checkout"}</Pill>
          {source.status.active ? null : <Pill tone="warn">Off</Pill>}
        </div>
        {source.notes ? <p className="mt-1 max-w-xl text-xs text-muted">{source.notes}</p> : null}
        {source.status.active ? null : <p className="mt-1 max-w-xl text-xs text-warn">{source.status.reason}</p>}
        {error ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-6">
        <label className="flex items-center gap-2 text-xs text-muted">
          <Switch on={source.enabled} onClick={() => flip("enabled")} label={`Scan ${source.name}`} disabled={pending} />
          Scan
        </label>
        <label
          className="flex items-center gap-2 text-xs text-muted"
          title={api ? undefined : "This source has no ordering API. A person always finishes checkout."}
        >
          <Switch
            on={api && source.autoBuyAllowed}
            onClick={() => flip("autoBuyAllowed")}
            label={`Allow auto-buy from ${source.name}`}
            disabled={pending || !api}
          />
          Auto-buy
        </label>
      </div>
    </li>
  );
}
