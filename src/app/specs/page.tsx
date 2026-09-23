import type { Metadata } from "next";
import Link from "next/link";
import { toggleSpec } from "@/app/actions";
import { Card, Pill, Progress, btn, cx } from "@/components/ui";
import { loadSpecs } from "@/data/loaders";
import { CATEGORIES, COLORS, CONDITIONS, MATERIALS, SIZES, label } from "@/lib/catalog";
import { formatCents } from "@/lib/money";

export const metadata: Metadata = { title: "Specs" };

export default async function SpecsPage() {
  const rows = await loadSpecs();

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Specs</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            What to look for and the most to pay. These are placeholders until Nick confirms J&amp;N&apos;s real sizes,
            materials and price limits.
          </p>
        </div>
        <Link href="/specs/new" className={cx(btn.base, btn.primary)}>
          New spec
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {rows.map(({ spec, owned, pending }) => (
          <Card key={spec.id} className={cx("flex flex-col gap-4", !spec.active && "opacity-60")}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">{spec.name}</h2>
                <p className="mt-0.5 text-xs text-muted">
                  {label(COLORS, spec.color)} {spec.size ? `${label(SIZES, spec.size)} ` : ""}
                  {label(CATEGORIES, spec.category).toLowerCase()}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {pending ? <Pill tone="warn">{pending} waiting</Pill> : null}
                {!spec.active ? <Pill>Paused</Pill> : null}
              </div>
            </div>

            <dl className="grid grid-cols-3 gap-3 text-xs">
              <div>
                <dt className="text-muted">Max landed / unit</dt>
                <dd className="tabular mt-0.5 font-mono text-base font-semibold text-accent">
                  {formatCents(spec.maxUnitPriceCents)}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Min thread count</dt>
                <dd className="tabular mt-0.5 font-mono text-base font-semibold">{spec.minThreadCount ?? "Any"}</dd>
              </div>
              <div>
                <dt className="text-muted">Per order</dt>
                <dd className="tabular mt-0.5 font-mono text-base font-semibold">≤ {spec.maxUnitsPerOrder}</dd>
              </div>
            </dl>

            <div className="flex flex-wrap gap-1.5">
              {spec.materials.map((m) => (
                <Pill key={m}>{label(MATERIALS, m)}</Pill>
              ))}
              {spec.conditions.map((c) => (
                <Pill key={c} tone="accent">
                  {label(CONDITIONS, c)}
                </Pill>
              ))}
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-muted">Bought toward target</span>
                <span className="tabular font-mono">
                  {owned} / {spec.targetUnits}
                </span>
              </div>
              <Progress value={owned} max={spec.targetUnits} tone={owned >= spec.targetUnits ? "good" : "accent"} />
            </div>

            <div className="flex gap-2 border-t border-line pt-3">
              <Link href={`/specs/${spec.id}`} className={cx(btn.base, btn.secondary)}>
                Edit
              </Link>
              <form action={toggleSpec.bind(null, spec.id)}>
                <button type="submit" className={cx(btn.base, btn.ghost)}>
                  {spec.active ? "Pause" : "Resume"}
                </button>
              </form>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
