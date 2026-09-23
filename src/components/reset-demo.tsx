"use client";

import { useState, useTransition } from "react";
import { resetDemo } from "@/app/actions";
import { btn, cx } from "./ui";

/** Two-step so nobody wipes the demo by accident. */
export function ResetDemo() {
  const [armed, setArmed] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const go = (withScans: boolean) =>
    startTransition(async () => {
      const r = await resetDemo(withScans);
      setMessage(r.message);
      setArmed(false);
      // Forms on this page hold their own field values; reload so they show the reset ones.
      window.location.reload();
    });

  return (
    <div className="flex flex-col gap-3">
      {!armed ? (
        <div>
          <button type="button" className={cx(btn.base, btn.danger)} onClick={() => setArmed(true)} disabled={pending}>
            Reset demo data…
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-xl border border-danger/50 bg-danger-soft p-4">
          <p className="text-sm">
            This deletes every listing, order, text and activity entry, and puts specs, sources and settings back to the
            examples.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={cx(btn.base, btn.danger)} onClick={() => go(true)} disabled={pending}>
              {pending ? "Resetting…" : "Reset with sample scans"}
            </button>
            <button type="button" className={cx(btn.base, btn.secondary)} onClick={() => go(false)} disabled={pending}>
              Reset to empty
            </button>
            <button type="button" className={cx(btn.base, btn.ghost)} onClick={() => setArmed(false)} disabled={pending}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {message ? (
        <p role="status" className="text-xs text-good">
          {message}
        </p>
      ) : null}
    </div>
  );
}
