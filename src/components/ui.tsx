import type { ReactNode } from "react";

export const btn = {
  base: "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-55",
  primary: "bg-accent text-accent-ink hover:brightness-110",
  secondary: "border border-line bg-surface text-ink hover:border-accent hover:text-accent",
  good: "border border-good bg-good-soft text-good hover:brightness-105",
  danger: "border border-danger/60 bg-danger-soft text-danger hover:border-danger",
  ghost: "text-muted hover:text-ink",
};

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx("rounded-2xl border border-line bg-surface p-5", className)}>{children}</section>;
}

export function SectionHeader({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h2 className="text-base font-semibold">{title}</h2>
        {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
      </div>
      {action}
    </div>
  );
}

type Tone = "neutral" | "accent" | "good" | "warn" | "danger";

const toneClass: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted border-line",
  accent: "bg-accent-soft text-accent border-accent/40",
  good: "bg-good-soft text-good border-good/40",
  warn: "bg-warn-soft text-warn border-warn/40",
  danger: "bg-danger-soft text-danger border-danger/40",
};

export function Pill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        toneClass[tone],
      )}
    >
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "accent" | "warn";
}) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-line bg-surface px-4 py-3.5">
      <span className="text-xs font-medium text-muted">{label}</span>
      <span
        className={cx(
          "tabular font-mono text-2xl font-semibold leading-tight",
          tone === "accent" && "text-accent",
          tone === "warn" && "text-warn",
        )}
      >
        {value}
      </span>
      {sub ? <span className="text-xs text-muted">{sub}</span> : null}
    </div>
  );
}

export function Progress({ value, max, tone = "accent" }: { value: number; max: number; tone?: "accent" | "warn" | "good" }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const bar = tone === "warn" ? "bg-warn" : tone === "good" ? "bg-good" : "bg-accent";
  return (
    <div
      className="h-2 overflow-hidden rounded-full border border-line bg-surface-2"
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <div className={cx("h-full rounded-full transition-[width] duration-300", bar)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
      {children}
    </div>
  );
}
