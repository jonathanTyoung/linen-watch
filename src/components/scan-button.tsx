"use client";

import { useState, useTransition } from "react";
import { scanNow } from "@/app/actions";
import { btn, cx } from "./ui";

export function ScanButton({ className }: { className?: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  return (
    <div className={cx("flex flex-wrap items-center gap-3", className)}>
      <button
        type="button"
        className={cx(btn.base, btn.primary)}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setResult(await scanNow());
          })
        }
      >
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          className={cx("h-3.5 w-3.5", pending && "animate-spin")}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path d="M13.5 8A5.5 5.5 0 1 1 11.9 4.1" strokeLinecap="round" />
          <path d="M12 1.5V4.5H9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {pending ? "Scanning sources…" : "Scan now"}
      </button>
      {result ? (
        <span className={cx("text-xs", result.ok ? "text-muted" : "text-danger")} role="status">
          {result.message}
        </span>
      ) : null}
    </div>
  );
}
