import { and, inArray, isNull, lt, notInArray, or } from "drizzle-orm";
import type { Queryable } from "@/db/client";
import { events, listings, orders } from "@/db/schema";
import { EBAY_DATA_MAX_AGE_HOURS } from "./sources/ebay/config";
import { EBAY_SOURCE_ID } from "./sources/selection";

/** Sources whose listing data we only keep while it's fresh. */
const FRESHNESS_SOURCES = [EBAY_SOURCE_ID];

/** True for sources whose listings get deleted once stale. */
export function keepsOnlyFreshData(sourceId: string): boolean {
  return FRESHNESS_SOURCES.includes(sourceId);
}

/**
 * An approved buy that expired unbought can still be marked bought, so it's
 * kept this long after expiring before it's dropped like the rest.
 */
export const LATE_CHECKOUT_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

/** Every status where nothing more is going to happen to the listing. */
const DROPPABLE = ["unmatched", "blocked", "expired", "rejected"];

/**
 * Delete listing data from real marketplaces that has gone stale: rows that
 * came to nothing (not a match, blocked, expired, skipped) and haven't shown
 * up in a search for EBAY_DATA_MAX_AGE_HOURS. Anything tied to an order is kept. Activity entries
 * about a deleted listing go with it, since they quote its title.
 * Returns how many listings were removed.
 */
export function removeStaleListings(db: Queryable, now: Date): number {
  const ordered = db.select({ id: orders.listingId }).from(orders);
  const stale = db
    .select({ id: listings.id })
    .from(listings)
    .where(
      and(
        inArray(listings.sourceId, FRESHNESS_SOURCES),
        inArray(listings.status, DROPPABLE),
        lt(listings.lastSeenAt, new Date(now.getTime() - EBAY_DATA_MAX_AGE_HOURS * 60 * 60 * 1000)),
        notInArray(listings.id, ordered),
        or(
          isNull(listings.checkoutExpiredAt),
          lt(listings.checkoutExpiredAt, new Date(now.getTime() - LATE_CHECKOUT_KEEP_MS)),
        ),
      ),
    )
    .all()
    .map((r) => r.id);

  // Stay well under SQLite's bound-parameter limit.
  for (let i = 0; i < stale.length; i += 500) {
    const ids = stale.slice(i, i + 500);
    db.delete(events).where(inArray(events.listingId, ids)).run();
    db.delete(listings).where(inArray(listings.id, ids)).run();
  }
  return stale.length;
}
