"use client";

import { useState, useTransition } from "react";
import { approve, markPurchased, reject } from "@/app/actions";
import { btn, cx } from "./ui";

type Result = { ok: boolean; message: string; warning?: string } | null;

export function ListingActions({
  listingId,
  status,
  url,
  sourceName,
  approveLabel,
  boughtLate = false,
}: {
  listingId: number;
  status: string;
  url: string;
  sourceName: string;
  approveLabel: string;
  /** The approval expired before anyone marked it bought. They may have bought it anyway. */
  boughtLate?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [which, setWhich] = useState<string | null>(null);
  const [result, setResult] = useState<Result>(null);

  const run = (name: string, fn: () => Promise<NonNullable<Result>>) => {
    setWhich(name);
    startTransition(async () => {
      setResult(await fn());
    });
  };

  if (status === "pending") {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={cx(btn.base, btn.good)}
            disabled={pending}
            onClick={() => run("approve", () => approve(listingId))}
          >
            {pending && which === "approve" ? "Ordering…" : approveLabel}
          </button>
          <button
            type="button"
            className={cx(btn.base, btn.secondary)}
            disabled={pending}
            onClick={() => run("reject", () => reject(listingId))}
          >
            Skip
          </button>
        </div>
        <Feedback result={result} />
      </div>
    );
  }

  if (status === "awaiting_checkout") {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <a href={url} target="_blank" rel="noreferrer" className={cx(btn.base, btn.secondary)}>
            Open on {sourceName.replace(/ \(mock\)$/, "")} ↗
          </a>
          <button
            type="button"
            className={cx(btn.base, btn.good)}
            disabled={pending}
            onClick={() => run("bought", () => markPurchased(listingId))}
          >
            I bought it
          </button>
          <button
            type="button"
            className={cx(btn.base, btn.ghost)}
            disabled={pending}
            onClick={() => run("reject", () => reject(listingId))}
          >
            Didn&apos;t buy
          </button>
        </div>
        <Feedback result={result} />
      </div>
    );
  }

  if (boughtLate) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <a href={url} target="_blank" rel="noreferrer" className={cx(btn.base, btn.secondary)}>
            Open on {sourceName.replace(/ \(mock\)$/, "")} ↗
          </a>
          <button
            type="button"
            className={cx(btn.base, btn.secondary)}
            disabled={pending}
            onClick={() => run("bought", () => markPurchased(listingId))}
          >
            I bought it
          </button>
        </div>
        <p className="text-xs text-muted">
          Bought it anyway? Mark it so the spend is counted, even if it goes over the weekly cap.
        </p>
        <Feedback result={result} />
      </div>
    );
  }

  // Keep showing what happened after the listing moves on (e.g. a late "I bought it").
  return <Feedback result={result} />;
}

function Feedback({ result }: { result: Result }) {
  if (!result) return null;
  return (
    <div role="status" className="flex flex-col gap-1 text-xs">
      <p className={result.ok ? "text-good" : "text-danger"}>{result.message}</p>
      {result.warning ? <p className="text-warn">{result.warning}</p> : null}
    </div>
  );
}
