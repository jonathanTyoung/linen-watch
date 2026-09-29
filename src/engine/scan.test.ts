import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb, type DB } from "@/db/client";
import { events, listings, notifications, orders, settings, sources } from "@/db/schema";
import { heldCents } from "./holds";
import { getAdapter } from "./sources";
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

describe("purchase races", () => {
  /** A pending match on `sourceId`, costing `lotPriceCents` for one lot of 12. */
  function pendingListing(sourceId: string, externalId: string, lotPriceCents: number, on: DB = db) {
    const now = new Date();
    return on
      .insert(listings)
      .values({
        sourceId,
        externalId,
        title: `White Percale Queen Flat Sheet, 300TC — Lot of 12 (${externalId})`,
        url: `https://example.com/${externalId}`,
        category: "flat_sheet",
        size: "queen",
        color: "white",
        material: "percale",
        threadCount: 300,
        condition: "new",
        lotPriceCents,
        lotSize: 12,
        lotsAvailable: 1,
        shippingCents: 0,
        status: "pending",
        matchedSpecId: 1,
        proposedLots: 1,
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .returning()
      .get();
  }

  const noFailure = { rng: () => 0.99 };

  it("two people approving the same listing place exactly one order", async () => {
    const l = pendingListing("mock-wholesale", "race-1", 9000);
    const results = await Promise.all([
      approveListing(db, l.id, "nick", noFailure),
      approveListing(db, l.id, "jake", noFailure),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)?.message).toMatch(/already handled/);
    expect(db.select().from(orders).where(eq(orders.listingId, l.id)).all()).toHaveLength(1);
  });

  it("two approvals near the weekly cap can't overshoot it together", async () => {
    db.update(settings).set({ weeklyCapCents: 15000, perOrderCapCents: 15000 }).run();
    const a = pendingListing("mock-wholesale", "race-a", 9000);
    const b = pendingListing("mock-wholesale", "race-b", 9000);
    const results = await Promise.all([
      approveListing(db, a.id, "nick", noFailure),
      approveListing(db, b.id, "jake", noFailure),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)?.message).toMatch(/cap/);
    expect(db.select().from(orders).all()).toHaveLength(1);
    expect(weekSpendCents(db)).toBeLessThanOrEqual(15000);
  });

  const statusOf = (id: number, on: DB = db) =>
    on.select().from(listings).where(eq(listings.id, id)).get()?.status;
  const hours = (n: number) => new Date(Date.now() + n * 60 * 60 * 1000);

  describe("approved buys waiting on checkout", () => {
    beforeEach(() => {
      db.update(settings).set({ weeklyCapCents: 15000, perOrderCapCents: 15000 }).run();
    });

    it("hold their total against the weekly cap", async () => {
      const a = pendingListing("mock-retail", "hold-a", 9000);
      const b = pendingListing("mock-retail", "hold-b", 9000);
      expect((await approveListing(db, a.id, "nick")).ok).toBe(true);
      expect(heldCents(db)).toBe(9000);

      const second = await approveListing(db, b.id, "jake");
      expect(second.ok).toBe(false);
      expect(second.message).toMatch(/\$90\.00 already approved but not bought yet/);
      expect(statusOf(b.id)).toBe("pending");
    });

    it("let go of the hold as soon as someone taps Didn't buy", async () => {
      const a = pendingListing("mock-retail", "hold-a", 9000);
      const b = pendingListing("mock-retail", "hold-b", 9000);
      await approveListing(db, a.id, "nick");
      expect((await approveListing(db, b.id, "jake")).ok).toBe(false);

      expect(rejectListing(db, a.id, "nick").ok).toBe(true);
      expect(heldCents(db)).toBe(0);
      expect((await approveListing(db, b.id, "jake")).ok).toBe(true);
    });

    it("expire after 24 hours and stop counting against the cap", async () => {
      const a = pendingListing("mock-retail", "hold-a", 9000);
      const b = pendingListing("mock-retail", "hold-b", 9000);
      await approveListing(db, a.id, "nick");

      // Still held the next morning.
      expect((await approveListing(db, b.id, "jake", { now: hours(23) })).ok).toBe(false);
      expect(statusOf(a.id)).toBe("awaiting_checkout");

      // Past 24 hours the approval itself releases it; no scan needed.
      expect((await approveListing(db, b.id, "jake", { now: hours(25) })).ok).toBe(true);
      const expired = db.select().from(listings).where(eq(listings.id, a.id)).get();
      expect(expired?.status).toBe("expired");
      expect(expired?.note).toMatch(/not marked bought within 24 hours/);
      expect(heldCents(db)).toBe(9000); // b's hold only
    });

    it("are expired by the scan too, and the scan counts them", async () => {
      const a = pendingListing("mock-retail", "hold-a", 9000);
      await approveListing(db, a.id, "nick");
      db.update(sources).set({ enabled: false }).run();

      const early = await runScan(db, { trigger: "manual", now: hours(23) });
      expect(!early.skipped && early.expired).toBe(0);
      const late = await runScan(db, { trigger: "manual", now: hours(25) });
      expect(!late.skipped && late.expired).toBe(1);
      expect(statusOf(a.id)).toBe("expired");
      expect(db.select().from(events).where(eq(events.listingId, a.id)).all().at(-1)?.message).toMatch(
        /no longer counts against the weekly cap/,
      );
    });

    it("use the expiry window from Settings", async () => {
      db.update(settings).set({ checkoutExpiryHours: 48 }).run();
      const a = pendingListing("mock-retail", "hold-a", 9000);
      const b = pendingListing("mock-retail", "hold-b", 9000);
      await approveListing(db, a.id, "nick");
      expect((await approveListing(db, b.id, "jake", { now: hours(25) })).ok).toBe(false);
      expect((await approveListing(db, b.id, "jake", { now: hours(49) })).ok).toBe(true);
    });

    it("turn into spend for the same amount when bought", async () => {
      const a = pendingListing("mock-retail", "hold-a", 9000);
      await approveListing(db, a.id, "nick");
      expect(confirmCheckout(db, a.id, "nick").ok).toBe(true);
      expect(heldCents(db)).toBe(0);
      expect(weekSpendCents(db)).toBe(9000);
      // A second tap doesn't record a second order.
      expect(confirmCheckout(db, a.id, "jake").ok).toBe(false);
      expect(db.select().from(orders).all()).toHaveLength(1);
    });
  });

  it("the scan's auto-buy counts holds against the weekly cap", async () => {
    db.update(settings).set({ autoBuyEnabled: true, weeklyCapCents: 30000, perOrderCapCents: 30000 }).run();
    db.update(sources).set({ autoBuyAllowed: true }).where(eq(sources.purchaseMethod, "api")).run();
    const a = pendingListing("mock-retail", "hold-a", 20000);
    expect((await approveListing(db, a.id, "nick")).ok).toBe(true);

    await scanMany(20);
    expect(heldCents(db)).toBe(20000);
    expect(weekSpendCents(db) + heldCents(db)).toBeLessThanOrEqual(30000);
    // The cap note on queued finds says where the money went.
    const capped = db.select().from(listings).where(eq(listings.status, "pending")).all();
    expect(capped.some((l) => /already approved but not bought yet/.test(l.note ?? ""))).toBe(true);
  });

  it("an approval made while an order is being placed sees that order's hold", async () => {
    db.update(settings).set({ weeklyCapCents: 15000, perOrderCapCents: 15000 }).run();
    const a = pendingListing("mock-wholesale", "race-a", 9000);
    const b = pendingListing("mock-retail", "race-b", 9000);

    const adapter = getAdapter("mock-wholesale")!;
    let midOrder: Awaited<ReturnType<typeof approveListing>> | undefined;
    const spy = vi.spyOn(adapter, "placeOrder").mockImplementation(async () => {
      expect(statusOf(a.id)).toBe("ordering");
      midOrder = await approveListing(db, b.id, "jake");
      return { ok: true, externalRef: "TEST-1" };
    });
    try {
      expect((await approveListing(db, a.id, "nick")).ok).toBe(true);
    } finally {
      spy.mockRestore();
    }
    expect(midOrder?.ok).toBe(false);
    expect(midOrder?.message).toMatch(/cap/);
    expect(statusOf(a.id)).toBe("purchased");
  });

  it("a failed order releases its hold", async () => {
    const a = pendingListing("mock-wholesale", "fail-a", 9000);
    const r = await approveListing(db, a.id, "nick", { rng: () => 0 }); // mock source fails the order
    expect(r.ok).toBe(false);
    expect(statusOf(a.id)).toBe("expired");
    expect(heldCents(db)).toBe(0);
    expect(db.select().from(orders).all()).toHaveLength(0);
  });

  it("an order that blows up mid-flight is flagged, not retried or left holding the cap", async () => {
    const a = pendingListing("mock-wholesale", "boom-a", 9000);
    const spy = vi.spyOn(getAdapter("mock-wholesale")!, "placeOrder").mockRejectedValue(new Error("socket hang up"));
    let r;
    try {
      r = await approveListing(db, a.id, "nick");
    } finally {
      spy.mockRestore();
    }
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/can't tell if it went through/);
    const row = db.select().from(listings).where(eq(listings.id, a.id)).get();
    expect(row?.status).toBe("expired");
    expect(row?.note).toMatch(/Check Wholesale supplier \(mock\) before buying this again/);
    expect(heldCents(db)).toBe(0);
  });

  it("an order left mid-flight by a crash is released by the next scan", async () => {
    const a = pendingListing("mock-wholesale", "crash-a", 9000);
    db.update(listings)
      .set({ status: "ordering", decidedBy: "nick", decidedAt: new Date() })
      .where(eq(listings.id, a.id))
      .run();
    db.update(sources).set({ enabled: false }).run();
    expect(heldCents(db)).toBe(9000);

    await runScan(db, { trigger: "manual", now: new Date(Date.now() + 5 * 60 * 1000) });
    expect(statusOf(a.id)).toBe("ordering"); // could still be in progress

    await runScan(db, { trigger: "manual", now: new Date(Date.now() + 11 * 60 * 1000) });
    expect(statusOf(a.id)).toBe("expired");
    expect(heldCents(db)).toBe(0);
  });

  describe("across two connections (the worker and the web app)", () => {
    let dir: string;
    let web: DB;
    let worker: DB;
    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "linen-watch-test-"));
      web = openDb(path.join(dir, "test.db"));
      worker = openDb(path.join(dir, "test.db"));
      web.update(settings).set({ weeklyCapCents: 15000, perOrderCapCents: 15000 }).run();
    });
    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it("the same listing approved from both is ordered once", async () => {
      const l = pendingListing("mock-wholesale", "race-1", 9000, web);
      const results = await Promise.all([
        approveListing(web, l.id, "nick", noFailure),
        approveListing(worker, l.id, "jake", noFailure),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(worker.select().from(orders).all()).toHaveLength(1);
    });

    it("two listings near the cap approved from both never overshoot it", async () => {
      const a = pendingListing("mock-wholesale", "race-a", 9000, web);
      const b = pendingListing("mock-wholesale", "race-b", 9000, web);
      const results = await Promise.all([
        approveListing(web, a.id, "nick", noFailure),
        approveListing(worker, b.id, "jake", noFailure),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(weekSpendCents(web) + heldCents(web)).toBeLessThanOrEqual(15000);
    });
  });
});
