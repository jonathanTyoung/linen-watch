import { and, eq, gte, lt } from "drizzle-orm";
import type { Queryable } from "@/db/client";
import { skippedItems } from "@/db/schema";

/**
 * Remembering what someone skipped. Listing rows from a marketplace are
 * deleted once they go stale, and without this a skipped listing would come
 * back into the queue the next time it showed up in a search. Only the
 * source's item id and the time are kept.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export function recordSkip(db: Queryable, sourceId: string, externalId: string, now: Date): void {
  db.insert(skippedItems)
    .values({ sourceId, externalId, skippedAt: now })
    .onConflictDoUpdate({ target: [skippedItems.sourceId, skippedItems.externalId], set: { skippedAt: now } })
    .run();
}

/** When this item was skipped, if that was within the last `days` days. */
export function skippedWithin(
  db: Queryable,
  sourceId: string,
  externalId: string,
  now: Date,
  days: number,
): Date | null {
  const row = db
    .select({ skippedAt: skippedItems.skippedAt })
    .from(skippedItems)
    .where(
      and(
        eq(skippedItems.sourceId, sourceId),
        eq(skippedItems.externalId, externalId),
        gte(skippedItems.skippedAt, new Date(now.getTime() - days * DAY_MS)),
      ),
    )
    .get();
  return row?.skippedAt ?? null;
}

/** Drop skips older than `days` days. Returns how many were dropped. */
export function forgetOldSkips(db: Queryable, now: Date, days: number): number {
  return db
    .delete(skippedItems)
    .where(lt(skippedItems.skippedAt, new Date(now.getTime() - days * DAY_MS)))
    .run().changes;
}
