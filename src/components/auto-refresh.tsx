"use client";

import { useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";

const KEY = "lw:live";
const listeners = new Set<() => void>();

function readLive(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

function writeLive(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {}
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

/**
 * The worker writes to the database from another process, so the page pulls
 * fresh data on a timer while "Live" is on. Skipped while the tab is hidden.
 */
export function AutoRefresh({ seconds = 5 }: { seconds?: number }) {
  const router = useRouter();
  const live = useSyncExternalStore(subscribe, readLive, () => true);

  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [live, seconds, router]);

  return (
    <button
      type="button"
      onClick={() => writeLive(!live)}
      aria-pressed={live}
      title={live ? `Refreshing every ${seconds}s. Click to stop.` : "Click to refresh automatically"}
      className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-medium text-muted hover:text-ink"
    >
      <span className={`h-1.5 w-1.5 rounded-full ${live ? "animate-pulse bg-good" : "bg-muted"}`} />
      {live ? "Live" : "Paused"}
    </button>
  );
}
