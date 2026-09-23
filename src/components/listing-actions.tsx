"use client";

import { useState, useTransition } from "react";
import { approve, markPurchased, reject } from "@/app/actions";
import { btn, cx } from "./ui";

type Result = { ok: boolean; message: string } | null;

export function ListingActions({
  listingId,
  status,
  url,
  sourceName,
  approveLabel,
}: {
  listingId: number;
  status: string;
  url: string;
  sourceName: string;
  approveLabel: string;
}) {
  const [pending, startTransition] = useTransition();
  const [which, setWhich] = useState<string | null>(null);
  const [result, setResult] = useState<Result>(null);

  const run = (name: string, fn: () => Promise<{ ok: boolean; message: string }>) => {
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

  return null;
}

function Feedback({ result }: { result: Result }) {
  if (!result) return null;
  return (
    <p role="status" className={cx("text-xs", result.ok ? "text-good" : "text-danger")}>
      {result.message}
    </p>
  );
}
