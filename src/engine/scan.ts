import { and, eq, isNull, lt, or } from "drizzle-orm";
import type { DB } from "@/db/client";
import {
  listings,
  notifications,
  orders,
  scanRuns,
  settings as settingsTable,
  sources,
  specs,
  type Listing,
  type Source,
  type Spec,
} from "@/db/schema";
import { formatCents, landedUnitCents } from "@/lib/money";
import { decide } from "./decide";
import { findMatch } from "./match";
import { getSettings, logEvent, unitsOwnedBySpec, weekSpendCents } from "./queries";
import { getAdapter, type RawListing } from "./sources";

export interface ScanOptions {
  trigger: "manual" | "worker";
  now?: Date;
  rng?: () => number;
}

export type ScanSummary =
  | { skipped: true; reason: string }
  | {
      skipped: false;
      runId: number;
      sourcesChecked: number;
      listingsSeen: number;
      newListings: number;
      matched: number;
      autoBought: number;
      queued: number;
      blocked: number;
      expired: number;
      errors: string[];
    };

interface Digest {
  queued: string[];
  bought: string[];
}

const LOCK_MS = 2 * 60 * 1000;

/** Take the cross-process scan lock. False if another scan holds it. */
function acquireLock(db: DB, now: Date): boolean {
  const res = db
    .update(settingsTable)
    .set({ scanLockUntil: new Date(now.getTime() + LOCK_MS) })
    .where(
      and(
        eq(settingsTable.id, 1),
        or(isNull(settingsTable.scanLockUntil), lt(settingsTable.scanLockUntil, now)),
      ),
    )
    .run();
  return res.changes > 0;
}

function releaseLock(db: DB): void {
  db.update(settingsTable).set({ scanLockUntil: null }).where(eq(settingsTable.id, 1)).run();
}

/**
 * One pass of the agent: expire stale approvals, ask every enabled source for
 * listings, match them against specs, and buy / queue / block each match
 * according to the guardrails. The worker calls this on an interval; the
 * "Scan now" button calls it once.
 */
export async function runScan(db: DB, opts: ScanOptions): Promise<ScanSummary> {
  const now = opts.now ?? new Date();
  const rng = opts.rng ?? Math.random;

  if (!acquireLock(db, now)) {
    return { skipped: true, reason: "A scan is already running" };
  }

  try {
    const run = db
      .insert(scanRuns)
      .values({ trigger: opts.trigger, startedAt: now })
      .returning({ id: scanRuns.id })
      .get();

    const settings = getSettings(db);
    const counts = {
      sourcesChecked: 0,
      listingsSeen: 0,
      newListings: 0,
      matched: 0,
      autoBought: 0,
      queued: 0,
      blocked: 0,
      expired: 0,
    };
    const errors: string[] = [];
    const digest: Digest = { queued: [], bought: [] };

    // 1. Pending listings go stale: real listings sell out or disappear.
    const staleBefore = new Date(now.getTime() - settings.pendingExpiryMinutes * 60 * 1000);
    counts.expired = db
      .update(listings)
      .set({ status: "expired", note: "Nobody approved it in time; the listing has likely sold", decidedBy: "system", decidedAt: now })
      .where(and(eq(listings.status, "pending"), lt(listings.firstSeenAt, staleBefore)))
      .run().changes;

    const activeSpecs = db.select().from(specs).where(eq(specs.active, true)).all();
    const enabledSources = db.select().from(sources).where(eq(sources.enabled, true)).all();
    const owned = unitsOwnedBySpec(db);
    let weekSpend = weekSpendCents(db, now);

    // 2. Each source independently; one failing source doesn't stop the rest.
    for (const source of enabledSources) {
      const adapter = getAdapter(source.id);
      if (!adapter) {
        errors.push(`No adapter registered for ${source.name}`);
        continue;
      }
      let raw: RawListing[];
      try {
        raw = await adapter.fetchListings({ now, rng });
      } catch (err) {
        errors.push(`${source.name}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      counts.sourcesChecked++;
      counts.listingsSeen += raw.length;

      for (const item of raw) {
        const { row, isNew, shouldEvaluate } = upsertListing(db, source, item, now);
        if (isNew) counts.newListings++;
        if (!shouldEvaluate) continue;

        const outcome = await evaluate(db, {
          listing: row,
          source,
          specs: activeSpecs,
          owned,
          weekSpend,
          settings,
          now,
          rng,
          adapterPlaceOrder: adapter.placeOrder?.bind(adapter),
        });

        if (outcome.kind === "matched") counts.matched++;
        if (outcome.kind === "matched" && outcome.result === "bought") {
          counts.autoBought++;
          weekSpend += outcome.totalCents;
          owned.set(outcome.specId, (owned.get(outcome.specId) ?? 0) + outcome.units);
          digest.bought.push(outcome.line);
        }
        if (outcome.kind === "matched" && outcome.result === "queued") {
          counts.queued++;
          digest.queued.push(outcome.line);
        }
        if (outcome.kind === "matched" && outcome.result === "blocked") counts.blocked++;
      }
    }

    // 3. One text per scan, not one per listing.
    const text = digestText(digest);
    if (text) {
      db.insert(notifications).values({ channel: "sms", recipient: "nick", body: text }).run();
    }

    const summaryBits = [
      `${counts.listingsSeen} listings from ${counts.sourcesChecked} sources`,
      `${counts.matched} matched`,
    ];
    if (counts.autoBought) summaryBits.push(`${counts.autoBought} bought`);
    if (counts.queued) summaryBits.push(`${counts.queued} waiting on approval`);
    if (counts.blocked) summaryBits.push(`${counts.blocked} blocked`);
    if (counts.expired) summaryBits.push(`${counts.expired} expired`);
    logEvent(db, {
      type: "scan",
      actor: "agent",
      message: `Scan (${opts.trigger === "worker" ? "scheduled" : "manual"}): ${summaryBits.join(", ")}`,
    });
    for (const e of errors) logEvent(db, { type: "error", actor: "system", message: e });

    db.update(scanRuns)
      .set({ ...counts, errors, finishedAt: new Date() })
      .where(eq(scanRuns.id, run.id))
      .run();

    return { skipped: false, runId: run.id, ...counts, errors };
  } finally {
    releaseLock(db);
  }
}

function upsertListing(
  db: DB,
  source: Source,
  item: RawListing,
  now: Date,
): { row: Listing; isNew: boolean; shouldEvaluate: boolean } {
  const existing = db
    .select()
    .from(listings)
    .where(and(eq(listings.sourceId, source.id), eq(listings.externalId, item.externalId)))
    .get();

  if (!existing) {
    const row = db
      .insert(listings)
      .values({
        sourceId: source.id,
        ...item,
        status: "unmatched",
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .returning()
      .get();
    return { row, isNew: true, shouldEvaluate: true };
  }

  const priceChanged =
    existing.lotPriceCents !== item.lotPriceCents || existing.shippingCents !== item.shippingCents;

  // Terminal states keep their price history as it was when decided.
  const live = existing.status === "unmatched" || existing.status === "pending";
  const row = live
    ? db
        .update(listings)
        .set({
          lotPriceCents: item.lotPriceCents,
          shippingCents: item.shippingCents,
          lotsAvailable: item.lotsAvailable,
          lastSeenAt: now,
        })
        .where(eq(listings.id, existing.id))
        .returning()
        .get()
    : db.update(listings).set({ lastSeenAt: now }).where(eq(listings.id, existing.id)).returning().get();

  // A price drop can turn a near-miss into a match.
  return { row, isNew: false, shouldEvaluate: existing.status === "unmatched" && priceChanged };
}

type EvalOutcome =
  | { kind: "unmatched" }
  | {
      kind: "matched";
      result: "bought" | "queued" | "blocked" | "failed";
      specId: number;
      units: number;
      totalCents: number;
      line: string;
    };

async function evaluate(
  db: DB,
  ctx: {
    listing: Listing;
    source: Source;
    specs: Spec[];
    owned: Map<number, number>;
    weekSpend: number;
    settings: ReturnType<typeof getSettings>;
    now: Date;
    rng: () => number;
    adapterPlaceOrder?: NonNullable<ReturnType<typeof getAdapter>>["placeOrder"];
  },
): Promise<EvalOutcome> {
  const { listing, source, now, rng } = ctx;
  const match = findMatch(listing, ctx.specs, ctx.owned);

  if (match.kind === "no_match") {
    db.update(listings)
      .set({ status: "unmatched", note: match.reason, matchedSpecId: null, proposedLots: null })
      .where(eq(listings.id, listing.id))
      .run();
    return { kind: "unmatched" };
  }

  const spec = match.spec;
  const decision = decide({
    listing,
    spec,
    source,
    settings: ctx.settings,
    unitsOwned: ctx.owned.get(spec.id) ?? 0,
    weekSpendCents: ctx.weekSpend,
  });
  const unit = formatCents(landedUnitCents(listing.lotPriceCents, listing.lotSize, listing.shippingCents));

  if (decision.kind === "blocked") {
    db.update(listings)
      .set({ status: "blocked", matchedSpecId: spec.id, note: decision.note, decidedBy: "agent", decidedAt: now })
      .where(eq(listings.id, listing.id))
      .run();
    logEvent(db, {
      type: "blocked",
      actor: "agent",
      listingId: listing.id,
      message: `Skipped ${listing.title} on ${source.name}: ${decision.note}`,
    });
    return { kind: "matched", result: "blocked", specId: spec.id, units: 0, totalCents: 0, line: "" };
  }

  const line = `${spec.name}: ${decision.units} @ ${unit}/unit (${formatCents(decision.totalCents)}) from ${source.name}`;

  if (decision.kind === "queue" || !ctx.adapterPlaceOrder) {
    const note =
      decision.kind === "queue" ? decision.note : `${source.name} can't place orders automatically yet`;
    db.update(listings)
      .set({ status: "pending", matchedSpecId: spec.id, proposedLots: decision.lots, note })
      .where(eq(listings.id, listing.id))
      .run();
    logEvent(db, {
      type: "queued",
      actor: "agent",
      listingId: listing.id,
      message: `Found ${listing.title} at ${unit}/unit on ${source.name}. ${note}.`,
    });
    return { kind: "matched", result: "queued", specId: spec.id, units: decision.units, totalCents: decision.totalCents, line };
  }

  // Auto-buy.
  const result = await ctx.adapterPlaceOrder(
    { externalId: listing.externalId, lots: decision.lots, expectedLotPriceCents: listing.lotPriceCents },
    { now, rng },
  );

  if (!result.ok) {
    db.update(listings)
      .set({ status: "expired", matchedSpecId: spec.id, note: `Auto-buy failed: ${result.error}`, decidedBy: "agent", decidedAt: now })
      .where(eq(listings.id, listing.id))
      .run();
    logEvent(db, {
      type: "order_failed",
      actor: "agent",
      listingId: listing.id,
      message: `Tried to buy ${listing.title} on ${source.name}, but it failed: ${result.error}`,
    });
    return { kind: "matched", result: "failed", specId: spec.id, units: 0, totalCents: 0, line: "" };
  }

  const order = db
    .insert(orders)
    .values({
      listingId: listing.id,
      specId: spec.id,
      sourceId: source.id,
      lots: decision.lots,
      units: decision.units,
      subtotalCents: decision.subtotalCents,
      shippingCents: decision.shippingCents,
      totalCents: decision.totalCents,
      mode: "auto",
      placedBy: "agent",
      externalRef: result.externalRef,
    })
    .returning({ id: orders.id })
    .get();

  db.update(listings)
    .set({ status: "purchased", matchedSpecId: spec.id, proposedLots: decision.lots, note: decision.note, decidedBy: "agent", decidedAt: now })
    .where(eq(listings.id, listing.id))
    .run();
  logEvent(db, {
    type: "purchased",
    actor: "agent",
    listingId: listing.id,
    orderId: order.id,
    message: `Bought ${decision.units} ${spec.name.toLowerCase()} for ${formatCents(decision.totalCents)} from ${source.name}`,
  });
  return { kind: "matched", result: "bought", specId: spec.id, units: decision.units, totalCents: decision.totalCents, line };
}

function digestText(d: Digest): string | null {
  if (!d.queued.length && !d.bought.length) return null;
  const parts = ["Linen Watch"];
  const list = (lines: string[]) =>
    lines.slice(0, 3).map((l) => `• ${l}`).join("\n") + (lines.length > 3 ? `\n…and ${lines.length - 3} more` : "");
  if (d.bought.length) parts.push(`Bought automatically:\n${list(d.bought)}`);
  if (d.queued.length) {
    parts.push(`${d.queued.length === 1 ? "1 find needs" : `${d.queued.length} finds need`} your OK:\n${list(d.queued)}`);
    parts.push("Open the app to approve or skip.");
  }
  return parts.join("\n\n");
}
