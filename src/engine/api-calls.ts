import { and, eq, isNull, lt, sql } from "drizzle-orm";
import type { DB, Queryable } from "@/db/client";
import { apiCalls } from "@/db/schema";

/**
 * A daily allowance for calling an outside API, kept in the database so it
 * holds across the worker, the web app's "Scan now", and restarts. Every
 * call is counted before it's made; when the day's budget is used up, no
 * more calls go out until the next day.
 */

/** The business day runs on Central time (J&N is in Nashville). */
export const CALL_DAY_TIME_ZONE = "America/Chicago";

const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: CALL_DAY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The calendar day `now` falls on in Central time, as YYYY-MM-DD. */
export function callDay(now: Date): string {
  return dayFormat.format(now);
}

export interface CallLedger {
  /** Spend one call. False, and nothing spent, if today's budget is used up. */
  take(): boolean;
  readonly remaining: number;
}

/** For sources with no daily limit. */
export const UNLIMITED: CallLedger = { take: () => true, remaining: Infinity };

export interface DailyLedger extends CallLedger {
  readonly budget: number;
  readonly used: number;
  /**
   * Note that today's budget has been hit. True the first time it's called
   * on a given day, so the stop is reported once, not on every scan after.
   */
  markReached(): boolean;
}

export function callsOn(db: Queryable, api: string, now: Date): { calls: number; limitReachedAt: Date | null } {
  const row = db
    .select()
    .from(apiCalls)
    .where(and(eq(apiCalls.api, api), eq(apiCalls.day, callDay(now))))
    .get();
  return { calls: row?.calls ?? 0, limitReachedAt: row?.limitReachedAt ?? null };
}

export function dailyLedger(db: DB, api: string, budget: number, now: Date): DailyLedger {
  const day = callDay(now);
  const today = and(eq(apiCalls.api, api), eq(apiCalls.day, day));
  const ensureRow = (tx: Queryable) => tx.insert(apiCalls).values({ api, day }).onConflictDoNothing().run();

  return {
    budget,
    get used() {
      return callsOn(db, api, now).calls;
    },
    get remaining() {
      return Math.max(0, budget - callsOn(db, api, now).calls);
    },
    take() {
      // One write, so two processes can't both take the last call.
      return db.transaction((tx) => {
        ensureRow(tx);
        const spent = tx
          .update(apiCalls)
          .set({ calls: sql`${apiCalls.calls} + 1` })
          .where(and(today, lt(apiCalls.calls, budget)))
          .run().changes;
        return spent === 1;
      }, { behavior: "immediate" });
    },
    markReached() {
      return db.transaction((tx) => {
        ensureRow(tx);
        const first = tx
          .update(apiCalls)
          .set({ limitReachedAt: now })
          .where(and(today, isNull(apiCalls.limitReachedAt)))
          .run().changes;
        return first === 1;
      }, { behavior: "immediate" });
    },
  };
}

/** "Reached today's limit of 4,000 eBay calls…" for the scan log and Settings. */
export function limitReachedMessage(name: string, budget: number): string {
  return `Reached today's limit of ${budget.toLocaleString("en-US")} ${name} calls, so ${name} isn't being scanned until midnight Central. Everything else carries on. The limit is in Settings.`;
}
