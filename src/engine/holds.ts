import { and, eq, inArray, lt, sql } from "drizzle-orm";
import type { Queryable } from "@/db/client";
import { listings, sources } from "@/db/schema";
import { getSettings, logEvent } from "./queries";

/**
 * Holds: money that's promised but isn't an order yet. A listing holds its
 * proposed order total against the weekly cap while it is
 *
 *   ordering           someone (or the agent) is placing the order right now
 *   awaiting_checkout  approved, waiting on a person to buy it on the site
 *
 * Without holds, two approvals can each pass the cap check and overshoot it
 * together. The hold ends when the listing leaves these statuses: bought
 * (it becomes an order), "Didn't buy", a failed order, or going stale here.
 */
export const HOLD_STATUSES = ["ordering", "awaiting_checkout"];

/** An order that has been "being placed" this long was interrupted (crash, restart). */
export const ORDER_CLAIM_STALE_MS = 10 * 60 * 1000;

export function heldCents(db: Queryable): number {
  const row = db
    .select({
      total: sql<number>`coalesce(sum(coalesce(${listings.proposedLots}, 1) * ${listings.lotPriceCents} + ${listings.shippingCents}), 0)`,
    })
    .from(listings)
    .where(inArray(listings.status, HOLD_STATUSES))
    .get();
  return row?.total ?? 0;
}

/** Units in held listings, per spec id. They count toward a spec's target like bought units. */
export function unitsHeldBySpec(db: Queryable): Map<number, number> {
  const rows = db
    .select({
      specId: listings.matchedSpecId,
      units: sql<number>`sum(coalesce(${listings.proposedLots}, 1) * ${listings.lotSize})`,
    })
    .from(listings)
    .where(inArray(listings.status, HOLD_STATUSES))
    .groupBy(listings.matchedSpecId)
    .all();
  return new Map(rows.flatMap((r) => (r.specId == null ? [] : [[r.specId, r.units] as const])));
}

/**
 * Let go of holds nobody is going to finish. Runs at the start of every scan
 * and before every approval, so a forgotten approval can't tie up the cap.
 * Returns how many listings were released.
 */
export function releaseStaleHolds(db: Queryable, now: Date): number {
  const { checkoutExpiryHours } = getSettings(db);
  const hours = `${checkoutExpiryHours} hour${checkoutExpiryHours === 1 ? "" : "s"}`;

  const unbought = db
    .update(listings)
    .set({
      status: "expired",
      note: `Approved but not marked bought within ${hours}, so it no longer counts against the weekly cap. If you did buy it, mark it bought`,
      decidedBy: "system",
      decidedAt: now,
      checkoutExpiredAt: now,
    })
    .where(
      and(
        eq(listings.status, "awaiting_checkout"),
        lt(listings.decidedAt, new Date(now.getTime() - checkoutExpiryHours * 60 * 60 * 1000)),
      ),
    )
    .returning({ id: listings.id, title: listings.title })
    .all();
  for (const l of unbought) {
    logEvent(db, {
      type: "expired",
      actor: "system",
      listingId: l.id,
      message: `${l.title} was approved but not marked bought within ${hours}. It no longer counts against the weekly cap.`,
    });
  }

  const interrupted = db
    .select({ id: listings.id, title: listings.title, sourceName: sources.name })
    .from(listings)
    .innerJoin(sources, eq(sources.id, listings.sourceId))
    .where(
      and(eq(listings.status, "ordering"), lt(listings.decidedAt, new Date(now.getTime() - ORDER_CLAIM_STALE_MS))),
    )
    .all();
  for (const l of interrupted) {
    db.update(listings)
      .set({ status: "expired", note: interruptedNote(l.sourceName), decidedBy: "system", decidedAt: now })
      .where(and(eq(listings.id, l.id), eq(listings.status, "ordering")))
      .run();
    logEvent(db, {
      type: "order_failed",
      actor: "system",
      listingId: l.id,
      message: `The order for ${l.title} was interrupted. ${interruptedNote(l.sourceName)}.`,
    });
  }

  return unbought.length + interrupted.length;
}

/** For an order that started but never reported back: we don't know if it went through. */
export function interruptedNote(sourceName: string): string {
  return `The order was interrupted, so we can't tell if it went through. Check ${sourceName} before buying this again`;
}
