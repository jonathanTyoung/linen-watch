"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";
import { saveSpec, type FormState } from "@/app/actions";
import type { Spec } from "@/db/schema";
import {
  CATEGORIES,
  COLORS,
  CONDITIONS,
  MATERIALS,
  SIZES,
  SIZES_BY_CATEGORY,
  type Category,
} from "@/lib/catalog";
import { btn, cx } from "./ui";

const input =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none";

function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

function Checks({
  name,
  options,
  selected,
}: {
  name: string;
  options: Record<string, string>;
  selected: string[];
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {Object.entries(options).map(([value, text]) => (
        <label
          key={value}
          className="flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft"
        >
          <input
            type="checkbox"
            id={`${name}-${value}`}
            name={name}
            value={value}
            defaultChecked={selected.includes(value)}
            className="accent-[var(--accent)]"
          />
          {text}
        </label>
      ))}
    </div>
  );
}

export function SpecForm({ spec }: { spec?: Spec }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveSpec, {});
  const [category, setCategory] = useState<Category>((spec?.category as Category) ?? "flat_sheet");
  const sizes = SIZES_BY_CATEGORY[category];
  const e = state.errors ?? {};

  return (
    <form
      // Submit via onSubmit (not the action prop) so React doesn't reset the
      // fields when validation fails.
      onSubmit={(ev) => {
        ev.preventDefault();
        const data = new FormData(ev.currentTarget);
        startTransition(() => action(data));
      }}
      className="flex flex-col gap-6"
    >
      {spec ? <input type="hidden" name="id" value={spec.id} /> : null}

      <Field label="Name" htmlFor="name" error={e.name} hint="What Nick and Jake will call it, e.g. Queen flat sheets.">
        <input id="name" name="name" defaultValue={spec?.name} className={input} required maxLength={60} />
      </Field>

      <div className="grid gap-5 sm:grid-cols-3">
        <Field label="Item" htmlFor="category" error={e.category}>
          <select
            id="category"
            name="category"
            className={input}
            value={category}
            onChange={(ev) => setCategory(ev.target.value as Category)}
          >
            {Object.entries(CATEGORIES).map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Size" htmlFor="size" error={e.size}>
          {sizes.length ? (
            <select
              key={category}
              id="size"
              name="size"
              className={input}
              defaultValue={spec?.category === category ? (spec?.size ?? sizes[0]) : sizes[0]}
            >
              {sizes.map((s) => (
                <option key={s} value={s}>
                  {SIZES[s]}
                </option>
              ))}
            </select>
          ) : (
            <>
              <input type="hidden" name="size" value="" />
              <p className={cx(input, "text-muted")}>One size</p>
            </>
          )}
        </Field>
        <Field label="Color" htmlFor="color" error={e.color}>
          <select id="color" name="color" className={input} defaultValue={spec?.color ?? "white"}>
            {Object.entries(COLORS).map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Accepted materials" error={e.materials}>
        <Checks name="materials" options={MATERIALS} selected={spec?.materials ?? ["percale"]} />
      </Field>

      <Field label="Accepted condition" error={e.conditions} hint="Like-new hotel lots are often the best deals, if J&N is OK with them.">
        <Checks name="conditions" options={CONDITIONS} selected={spec?.conditions ?? ["new"]} />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Max landed price per unit"
          htmlFor="maxUnitPrice"
          error={e.maxUnitPrice}
          hint="Item plus shipping, divided by units in the lot."
        >
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
            <input
              id="maxUnitPrice"
              name="maxUnitPrice"
              inputMode="decimal"
              defaultValue={spec ? (spec.maxUnitPriceCents / 100).toFixed(2) : ""}
              placeholder="9.50"
              className={cx(input, "tabular pl-7 font-mono")}
              required
            />
          </div>
        </Field>
        <Field
          label="Minimum thread count"
          htmlFor="minThreadCount"
          error={e.minThreadCount}
          hint="Leave blank to accept any, including listings that don't say."
        >
          <input
            id="minThreadCount"
            name="minThreadCount"
            inputMode="numeric"
            defaultValue={spec?.minThreadCount ?? ""}
            placeholder="250"
            className={cx(input, "tabular font-mono")}
          />
        </Field>
        <Field label="Target units" htmlFor="targetUnits" error={e.targetUnits} hint="Stop buying once this many have been bought.">
          <input
            id="targetUnits"
            name="targetUnits"
            inputMode="numeric"
            defaultValue={spec?.targetUnits ?? 100}
            className={cx(input, "tabular font-mono")}
            required
          />
        </Field>
        <Field label="Most units per order" htmlFor="maxUnitsPerOrder" error={e.maxUnitsPerOrder} hint="Keeps one great deal from eating the whole budget.">
          <input
            id="maxUnitsPerOrder"
            name="maxUnitsPerOrder"
            inputMode="numeric"
            defaultValue={spec?.maxUnitsPerOrder ?? 48}
            className={cx(input, "tabular font-mono")}
            required
          />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          id="active"
          name="active"
          defaultChecked={spec?.active ?? true}
          className="h-4 w-4 accent-[var(--accent)]"
        />
        Active: scans look for this
      </label>

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
        <button type="submit" className={cx(btn.base, btn.primary, "px-4 py-2")} disabled={pending}>
          {pending ? "Saving…" : spec ? "Save changes" : "Add spec"}
        </button>
        <Link href="/specs" className={cx(btn.base, btn.ghost)}>
          Cancel
        </Link>
        {state.message ? (
          <p role="status" className="text-sm text-danger">
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
