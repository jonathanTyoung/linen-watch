"use client";

import { startTransition, useActionState } from "react";
import { saveSettings, type FormState } from "@/app/actions";
import type { Settings } from "@/db/schema";
import { btn, cx } from "./ui";

const input =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none";

function Toggle({
  name,
  title,
  body,
  defaultChecked,
  tone,
}: {
  name: string;
  title: string;
  body: string;
  defaultChecked: boolean;
  tone: "accent" | "danger";
}) {
  return (
    <label
      className={cx(
        "flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-line bg-surface p-4",
        tone === "danger" ? "has-[:checked]:border-danger has-[:checked]:bg-danger-soft" : "has-[:checked]:border-accent has-[:checked]:bg-accent-soft",
      )}
    >
      <span>
        <span className="block text-sm font-semibold">{title}</span>
        <span className="mt-0.5 block text-xs text-muted">{body}</span>
      </span>
      <input
        type="checkbox"
        id={name}
        name={name}
        defaultChecked={defaultChecked}
        className={cx("mt-1 h-5 w-5 shrink-0", tone === "danger" ? "accent-[var(--danger)]" : "accent-[var(--accent)]")}
      />
    </label>
  );
}

function Money({ id, label, hint, error, cents }: { id: string; label: string; hint: string; error?: string; cents: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
        <input
          id={id}
          name={id}
          inputMode="decimal"
          defaultValue={(cents / 100).toFixed(0)}
          className={cx(input, "tabular pl-7 font-mono")}
        />
      </div>
      <p className={cx("text-xs", error ? "text-danger" : "text-muted")}>{error ?? hint}</p>
    </div>
  );
}

function NumberField({
  id,
  label,
  hint,
  error,
  value,
  unit,
}: {
  id: string;
  label: string;
  hint: string;
  error?: string;
  value: number;
  unit: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="relative">
        <input id={id} name={id} inputMode="numeric" defaultValue={value} className={cx(input, "tabular pr-20 font-mono")} />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">{unit}</span>
      </div>
      <p className={cx("text-xs", error ? "text-danger" : "text-muted")}>{error ?? hint}</p>
    </div>
  );
}

export function SettingsForm({ settings }: { settings: Settings }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveSettings, {});
  const e = state.errors ?? {};

  return (
    <form
      onSubmit={(ev) => {
        ev.preventDefault();
        const data = new FormData(ev.currentTarget);
        startTransition(() => action(data));
      }}
      className="flex flex-col gap-6"
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Toggle
          name="autoBuyEnabled"
          title="Auto-buy"
          body="Let the agent buy matches on its own, from sources you've trusted below, within the caps."
          defaultChecked={settings.autoBuyEnabled}
          tone="accent"
        />
        <Toggle
          name="paused"
          title="Pause all buying"
          body="Kill switch. Nothing is bought, automatically or by approval. Scans keep queuing matches."
          defaultChecked={settings.paused}
          tone="danger"
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Money id="weeklyCap" label="Weekly spending cap" hint="Resets Monday. Covers auto-buys and approvals." error={e.weeklyCap} cents={settings.weeklyCapCents} />
        <Money id="perOrderCap" label="Per-order cap" hint="No single order, shipping included, can go over this." error={e.perOrderCap} cents={settings.perOrderCapCents} />
        <NumberField
          id="scanIntervalSeconds"
          label="Scan every"
          hint="How often the worker checks sources. Real sources would be minutes to hours."
          error={e.scanIntervalSeconds}
          value={settings.scanIntervalSeconds}
          unit="seconds"
        />
        <NumberField
          id="pendingExpiryMinutes"
          label="Approvals expire after"
          hint="Deals sell. Unanswered matches drop out of the queue after this."
          error={e.pendingExpiryMinutes}
          value={settings.pendingExpiryMinutes}
          unit="minutes"
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="notifyPhone" className="text-sm font-medium">
            Text alerts to
          </label>
          <input id="notifyPhone" name="notifyPhone" defaultValue={settings.notifyPhone ?? ""} className={cx(input, "tabular font-mono")} />
          <p className="text-xs text-muted">Shown on the mock texts. Nothing is sent from local dev.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
        <button type="submit" className={cx(btn.base, btn.primary, "px-4 py-2")} disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </button>
        {state.message ? (
          <p role="status" className={cx("text-sm", state.errors ? "text-danger" : "text-good")}>
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
