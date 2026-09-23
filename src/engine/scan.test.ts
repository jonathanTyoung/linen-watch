import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "@/db/client";
import { listings, notifications, orders, settings, sources } from "@/db/schema";
import { seeded } from "./sources/mock";
import { approveListing, confirmCheckout, rejectListing } from "./purchasing";
import { runScan } from "./scan";
import { weekSpendCents } from "./queries";

let db: DB;
beforeEach(() => {
  db = openDb(":memory:");
});

async function scanMany(n: number, seed = 42) {
  const rng = seeded(seed);
  for (let i = 0; i < n; i++) await runScan(db, { trigger: "manual", rng });
}

describe("runScan", () => {
  it("stores listings and queues matches when auto-buy is off", async () => {
    await scanMany(6);
    const all = db.select().from(listings).all();
    expect(all.length).toBeGreaterThan(10);
    expect(all.some((l) => l.status === "pending")).toBe(true);
    // Auto-buy is off by default: nothing bought.
    expect(db.select().from(orders).all()).toHaveLength(0);
    // Every non-match explains itself.
    expect(all.filter((l) => l.status === "unmatched").every((l) => l.note)).toBe(true);
  });

  it("texts a digest when something needs approval", async () => {
    await scanMany(6);
    const texts = db.select().from(notifications).all();
    expect(texts.length).toBeGreaterThan(0);
    expect(texts[0].body).toMatch(/your OK/);
  });

  it("never auto-buys from checkout-link sources, even with auto-buy on", async () => {
    db.update(settings).set({ autoBuyEnabled: true, weeklyCapCents: 10_000_000, perOrderCapCents: 10_000_000 }).run();
    db.update(sources).set({ autoBuyAllowed: true }).run();
    await scanMany(12);
    const bought = db.select().from(orders).all();
    expect(bought.length).toBeGreaterThan(0);
    expect(bought.every((o) => o.sourceId === "mock-wholesale" || o.sourceId === "mock-marketplace")).toBe(true);
  });

  it("keeps auto-buy spend under the weekly cap", async () => {
    db.update(settings).set({ autoBuyEnabled: true, weeklyCapCents: 30000 }).run();
    db.update(sources).set({ autoBuyAllowed: true }).where(eq(sources.purchaseMethod, "api")).run();
    await scanMany(20);
    expect(weekSpendCents(db)).toBeLessThanOrEqual(30000);
  });

  it("buys nothing while paused", async () => {
    db.update(settings).set({ autoBuyEnabled: true, paused: true }).run();
    await scanMany(8);
    expect(db.select().from(orders).all()).toHaveLength(0);
  });

  it("won't run two scans at once", async () => {
    const [a, b] = await Promise.all([
      runScan(db, { trigger: "manual" }),
      runScan(db, { trigger: "worker" }),
    ]);
    expect([a.skipped, b.skipped].sort()).toEqual([false, true]);
  });

  it("expires approvals nobody acted on", async () => {
    await scanMany(4);
    const pending = db.select().from(listings).where(eq(listings.status, "pending")).all();
    expect(pending.length).toBeGreaterThan(0);
    const later = new Date(Date.now() + 4 * 60 * 60 * 1000);
    const r = await runScan(db, { trigger: "manual", now: later, rng: seeded(7) });
    expect(!r.skipped && r.expired).toBeGreaterThanOrEqual(pending.length);
  });
});

describe("approving and rejecting", () => {
  async function firstPending(sourceId?: string) {
    for (let seed = 1; seed < 50; seed++) {
      await scanMany(3, seed);
      const rows = db.select().from(listings).where(eq(listings.status, "pending")).all();
      const hit = rows.find((r) => !sourceId || r.sourceId === sourceId);
      if (hit) return hit;
    }
    throw new Error("no pending listing found");
  }

  it("approving an API-source listing places the order", async () => {
    db.update(settings).set({ weeklyCapCents: 10_000_000, perOrderCapCents: 10_000_000 }).run();
    const l = await firstPending("mock-wholesale");
    const r = await approveListing(db, l.id, "nick", { rng: () => 0.99 });
    expect(r.ok).toBe(true);
    const row = db.select().from(listings).where(eq(listings.id, l.id)).get();
    expect(row?.status).toBe("purchased");
    expect(db.select().from(orders).where(eq(orders.listingId, l.id)).get()?.placedBy).toBe("nick");
  });

  it("approving a checkout-link listing waits for the person to check out", async () => {
    db.update(settings).set({ weeklyCapCents: 10_000_000, perOrderCapCents: 10_000_000 }).run();
    const l = await firstPending("mock-retail");
    const r = await approveListing(db, l.id, "jake");
    expect(r.ok).toBe(true);
    expect(db.select().from(listings).where(eq(listings.id, l.id)).get()?.status).toBe("awaiting_checkout");
    expect(db.select().from(orders).all()).toHaveLength(0);

    expect(confirmCheckout(db, l.id, "jake").ok).toBe(true);
    expect(db.select().from(orders).where(eq(orders.listingId, l.id)).get()?.mode).toBe("manual_checkout");
  });

  it("refuses approval while paused", async () => {
    const l = await firstPending();
    db.update(settings).set({ paused: true }).run();
    const r = await approveListing(db, l.id, "nick");
    expect(r).toEqual({ ok: false, message: expect.stringMatching(/paused/) });
  });

  it("rejecting takes the listing out of the queue", async () => {
    const l = await firstPending();
    expect(rejectListing(db, l.id, "nick").ok).toBe(true);
    expect(db.select().from(listings).where(eq(listings.id, l.id)).get()?.status).toBe("rejected");
    // A second person acting on it gets a clear answer, not a double action.
    expect(rejectListing(db, l.id, "jake").ok).toBe(false);
  });
});
