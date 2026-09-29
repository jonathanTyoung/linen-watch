import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb, type DB } from "@/db/client";
import { apiCalls, events, listings, notifications, orders, settings, skippedItems, sources } from "@/db/schema";
import { callDay, callsOn } from "./api-calls";
import { approveListing, confirmCheckout, rejectListing } from "./purchasing";
import { runScan } from "./scan";
import { fakeEbay, json, TEST_KEYS, type Override } from "./sources/ebay/__fixtures__/fake-ebay";
import emptySearch from "./sources/ebay/__fixtures__/search-empty.json";
import { seeded } from "./sources/mock";
import { sourceSelection, sourceStatus } from "./sources/selection";

/**
 * eBay end to end through the real scan, against saved responses. Nothing
 * here touches the network: `fetch` is replaced with a stand-in.
 */

let db: DB;
let ebay: ReturnType<typeof fakeEbay>;

function withEbay(opts: { sources?: string; keys?: boolean; override?: Override } = {}) {
  if (opts.sources) vi.stubEnv("LINEN_SOURCES", opts.sources);
  if (opts.keys !== false) for (const [k, v] of Object.entries(TEST_KEYS)) vi.stubEnv(k, v);
  ebay = fakeEbay(opts.override);
  vi.stubGlobal("fetch", ebay.fetch);
}

beforeEach(() => {
  db = openDb(":memory:");
  for (const k of ["LINEN_SOURCES", "EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET", "EBAY_ENV"]) vi.stubEnv(k, "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const scan = (now?: Date) => runScan(db, { trigger: "manual", now, rng: seeded(3) });
const byItem = (legacyId: string) =>
  db.select().from(listings).where(eq(listings.externalId, `v1|${legacyId}|0`)).get();
const ebayRows = () => db.select().from(listings).where(eq(listings.sourceId, "ebay")).all();

describe("choosing sources", () => {
  it("reads LINEN_SOURCES, defaulting to mock", () => {
    expect(sourceSelection({})).toBe("mock");
    expect(sourceSelection({ LINEN_SOURCES: "ebay" })).toBe("ebay");
    expect(sourceSelection({ LINEN_SOURCES: " ALL " })).toBe("all");
    expect(sourceSelection({ LINEN_SOURCES: "everything" })).toBe("mock");
  });

  it("says in plain words why a source is off", () => {
    expect(sourceStatus("ebay", {})).toEqual({
      active: false,
      reason: expect.stringMatching(/LINEN_SOURCES is set to mock/),
    });
    expect(sourceStatus("ebay", { LINEN_SOURCES: "ebay" })).toEqual({
      active: false,
      reason: expect.stringMatching(/API keys are missing. Add EBAY_CLIENT_ID and EBAY_CLIENT_SECRET to .env.local/),
    });
    expect(sourceStatus("ebay", { LINEN_SOURCES: "all", ...TEST_KEYS })).toEqual({ active: true });
    expect(sourceStatus("mock-retail", { LINEN_SOURCES: "ebay" }).active).toBe(false);
    expect(sourceStatus("mock-retail", { LINEN_SOURCES: "all" }).active).toBe(true);
  });

  it("every database has an eBay source row: manual checkout, never auto-buy", () => {
    expect(db.select().from(sources).where(eq(sources.id, "ebay")).get()).toMatchObject({
      name: "eBay",
      kind: "marketplace",
      purchaseMethod: "checkout_link",
      autoBuyAllowed: false,
    });
  });

  it("by default scans the mock sources and never calls eBay, even with keys present", async () => {
    withEbay();
    const r = await scan();
    expect(!r.skipped && r.sourcesChecked).toBe(4);
    expect(!r.skipped && r.errors).toEqual([]);
    expect(ebay.calls).toHaveLength(0);
    expect(ebayRows()).toHaveLength(0);
  });

  it("leaves eBay off, quietly, when the keys are missing", async () => {
    withEbay({ sources: "ebay", keys: false });
    const r = await scan();
    expect(!r.skipped && r.sourcesChecked).toBe(0);
    expect(!r.skipped && r.errors).toEqual([]);
    expect(ebay.calls).toHaveLength(0);
  });

  it("LINEN_SOURCES=ebay scans eBay alone", async () => {
    withEbay({ sources: "ebay" });
    const r = await scan();
    expect(r).toMatchObject({ sourcesChecked: 1, listingsSeen: 19, newListings: 19, errors: [] });
    expect(db.select().from(listings).all().every((l) => l.sourceId === "ebay")).toBe(true);
  });

  it("LINEN_SOURCES=all scans both", async () => {
    withEbay({ sources: "all" });
    const r = await scan();
    expect(!r.skipped && r.sourcesChecked).toBe(5);
    expect(ebayRows()).toHaveLength(19);
    expect(db.select().from(listings).all().some((l) => l.sourceId.startsWith("mock-"))).toBe(true);
  });

  it("respects the Scan switch in Settings", async () => {
    withEbay({ sources: "ebay" });
    db.update(sources).set({ enabled: false }).where(eq(sources.id, "ebay")).run();
    await scan();
    expect(ebay.calls).toHaveLength(0);
  });
});

describe("scanning eBay", () => {
  beforeEach(() => withEbay({ sources: "ebay" }));

  it("queues what matches", async () => {
    const r = await scan();
    expect(r).toMatchObject({ matched: 6, queued: 6, autoBought: 0, blocked: 0 });
    const queued = db.select().from(listings).where(eq(listings.status, "pending")).all();
    expect(queued.map((l) => l.externalId).sort()).toEqual([
      "v1|285600000101|0", // 12 queen flat sheets, $9.00 each landed
      "v1|285600000102|0", // one queen flat sheet, $8.49
      "v1|285600000201|0", // 2 sateen queen flat sheets, $8.50 each
      "v1|285600000301|0", // a dozen standard pillowcases, $2.75 each
      "v1|285600000401|0", // 24 bath towels, $5.33 each
      "v1|285600000402|0", // one cotton bath towel, $5.50
    ]);
    expect(byItem("285600000101")).toMatchObject({ proposedLots: 1, note: "Auto-buy is off, so this waits for approval" });
  });

  it("never buys, even with auto-buy on and every source trusted", async () => {
    db.update(settings).set({ autoBuyEnabled: true, weeklyCapCents: 10_000_000, perOrderCapCents: 10_000_000 }).run();
    db.update(sources).set({ autoBuyAllowed: true }).run();
    const r = await scan();
    expect(r).toMatchObject({ matched: 6, queued: 6, autoBought: 0 });
    expect(db.select().from(orders).all()).toHaveLength(0);
    expect(byItem("285600000101")?.note).toBe("eBay needs a person to check out");
  });

  it("says why for everything that didn't match", async () => {
    await scan();
    const why = (legacyId: string) => byItem(legacyId)?.note;
    expect(why("285600000103")).toBe("Can't be sure it fits: it's a sheet set, not a single kind of item");
    expect(why("285600000104")).toBe("Close to Queen flat sheets, but poly-cotton blend isn't an accepted material");
    expect(why("285600000106")).toBe(
      "Can't be sure it fits: the listing covers several options (sizes or colors) and the price is for only one of them",
    );
    expect(why("285600000107")).toBe("Close to Queen flat sheets, but condition is like new");
    expect(why("285600000109")).toBe("Can't be sure it fits: it's sold for parts or not working");
    expect(why("285600000112")).toBe("Can't be sure it fits: the title lists more than one size (full, queen)");
    expect(why("285600000113")).toBe(
      "Can't be sure it fits: it looks like a multi-pack, but the count isn't in the title and shipping cost isn't listed",
    );
    expect(why("285600000202")).toBe("Can't be sure it fits: the title lists more than one color (white, gray)");
    expect(why("285600000303")).toBe("No active spec for king pillow pillowcases");
    expect(why("285600000302")).toBe("Close to Standard pillowcases, but $3.50/unit is over the $3.25 limit");
    expect(ebayRows().filter((l) => l.status === "unmatched").every((l) => l.note)).toBe(true);
  });

  it("never treats unknown shipping as free", async () => {
    await scan();
    // $30 for 4 is $7.50 each, under the $9.50 limit. With the $8.40 shipping
    // eBay gave on lookup it's $9.60, which isn't.
    expect(byItem("285600000105")).toMatchObject({
      status: "unmatched",
      shippingCents: 840,
      note: "Close to Queen flat sheets, but $9.60/unit is over the $9.50 limit",
    });
    // 12 towels for $38 would be a bargain, but eBay never gave a shipping cost.
    expect(byItem("285600000403")).toMatchObject({
      status: "unmatched",
      shippingCents: null,
      note: "Can't be sure it fits: shipping cost isn't listed",
    });
  });

  it("carries a caution onto the listing without stopping the match", async () => {
    await scan();
    // "Percale 300TC" with no fiber: queued, with a warning for whoever approves.
    expect(byItem("285600000102")).toMatchObject({
      status: "pending",
      material: "percale",
      cautions: [{ label: "Fiber not stated", detail: expect.stringMatching(/Check the listing before approving/) }],
    });
    // "100% Cotton" with no weave named: nothing to warn about.
    expect(byItem("285600000402")).toMatchObject({ status: "pending", material: "cotton_terry", cautions: null });
  });

  it("texts Nick one digest for the scan", async () => {
    await scan();
    const texts = db.select().from(notifications).all();
    expect(texts).toHaveLength(1);
    expect(texts[0].body).toMatch(/6 finds need your OK/);
    expect(texts[0].body).toMatch(/Queen flat sheets: 12 @ \$9\.00\/unit \(\$108\.00\) from eBay/);
  });

  it("approve hands over the eBay page; I bought it records the order", async () => {
    await scan();
    const l = byItem("285600000101")!;
    const approved = await approveListing(db, l.id, "nick");
    expect(approved).toEqual({ ok: true, message: "Approved. Finish checkout on eBay, then mark it purchased." });
    expect(byItem("285600000101")).toMatchObject({
      status: "awaiting_checkout",
      url: "https://www.ebay.com/itm/285600000101",
      note: "Approved by Nick. Buy 1 lot on eBay, then mark it purchased.",
    });
    expect(db.select().from(orders).all()).toHaveLength(0);

    expect(confirmCheckout(db, l.id, "nick").ok).toBe(true);
    expect(db.select().from(orders).where(eq(orders.listingId, l.id)).get()).toMatchObject({
      sourceId: "ebay",
      mode: "manual_checkout",
      units: 12,
      totalCents: 10800,
      externalRef: null,
    });
  });

  it("stores nothing about sellers, anywhere", async () => {
    await scan();
    const everything = JSON.stringify({
      listings: db.select().from(listings).all(),
      events: db.select().from(events).all(),
      notifications: db.select().from(notifications).all(),
    });
    expect(everything).not.toMatch(/fixture_seller|feedback/i);
  });

  it("reports a failed search without losing the rest", async () => {
    withEbay({
      sources: "ebay",
      override: (call) =>
        call.url.searchParams.get("q") === "white bath towel" ? json({ errors: [{ message: "Bad category" }] }, 400) : undefined,
    });
    const r = await scan();
    expect(r).toMatchObject({ sourcesChecked: 1, listingsSeen: 16 });
    expect(!r.skipped && r.errors).toEqual([
      'eBay: Search "white bath towel": eBay said HTTP 400 (Bad category). Skipped for this scan.',
    ]);
  });
});

describe("keeping eBay data fresh", () => {
  const t0 = new Date(2026, 8, 16, 9, 0, 0);
  const later = (h: number) => new Date(t0.getTime() + h * 60 * 60 * 1000);
  /** eBay stops returning anything: every listing has sold or ended. */
  const gone: Override = (call) => (call.url.pathname.endsWith("/item_summary/search") ? json(emptySearch) : undefined);

  beforeEach(() => withEbay({ sources: "ebay" }));

  it("looks again when a listing changes, and only then", async () => {
    await scan(t0);
    const before = byItem("285600000107")!;
    expect(before.status).toBe("unmatched");

    await scan(later(1));
    expect(db.select().from(events).where(eq(events.type, "queued")).all()).toHaveLength(6); // nothing queued twice
    expect(byItem("285600000107")?.lastSeenAt).toEqual(later(1));
  });

  it("queues a listing whose price drops into range, with the approval clock starting then", async () => {
    // $8.40 shipping made this $9.60 a unit. The seller drops the price by $2.
    await scan(t0);
    expect(byItem("285600000105")?.status).toBe("unmatched");

    withEbay({
      sources: "ebay",
      override: async (call) => {
        if (call.url.searchParams.get("q") !== "white queen flat sheet" || call.url.searchParams.get("offset") !== "0") return undefined;
        const page = (await import("./sources/ebay/__fixtures__/search-sheets-page1.json")).default;
        return json({
          ...page,
          itemSummaries: page.itemSummaries.map((i) =>
            i.legacyItemId === "285600000105" ? { ...i, price: { value: "28.00", currency: "USD" } } : i,
          ),
        });
      },
    });
    await scan(later(5));
    expect(byItem("285600000105")).toMatchObject({ status: "pending", lotPriceCents: 2800, shippingCents: 840 });

    // First seen six hours ago, but only queued one hour ago: still waiting.
    await scan(later(6));
    expect(byItem("285600000105")?.status).toBe("pending");
    await scan(later(9));
    expect(byItem("285600000105")?.status).toBe("expired");
  });

  it("deletes listings that came to nothing once they've gone unseen for 24 hours", async () => {
    await scan(t0);
    const skipped = byItem("285600000102")!;
    rejectListing(db, skipped.id, "nick");
    expect(ebayRows()).toHaveLength(19);

    withEbay({ sources: "ebay", override: gone });
    const day1 = await scan(later(23));
    expect(!day1.skipped && day1.removed).toBe(0);
    expect(ebayRows()).toHaveLength(19);

    const day2 = await scan(later(25));
    expect(!day2.skipped && day2.removed).toBe(19);
    expect(ebayRows()).toHaveLength(0);
    // What was said about them goes too: activity entries quote listing titles.
    expect(db.select().from(events).all().some((e) => /Flat Sheet|Pillowcase|Bath Towel/i.test(e.message))).toBe(false);
  });

  it("keeps listings that are still showing up", async () => {
    await scan(t0);
    await scan(later(20));
    const r = await scan(later(30));
    expect(!r.skipped && r.removed).toBe(0);
    expect(ebayRows()).toHaveLength(19);
  });

  it("keeps anything tied to an order, and anything still waiting on a person", async () => {
    await scan(t0);
    const bought = byItem("285600000101")!;
    await approveListing(db, bought.id, "nick", { now: t0 });
    confirmCheckout(db, bought.id, "nick", { now: t0 });

    withEbay({ sources: "ebay", override: gone });
    await scan(later(25));
    expect(ebayRows().map((l) => [l.externalId, l.status])).toEqual([["v1|285600000101|0", "purchased"]]);
    expect(db.select().from(orders).all()).toHaveLength(1);
  });

  it("keeps an expired approval for a week, so a late I-bought-it can still be recorded", async () => {
    await scan(t0);
    const approved = byItem("285600000401")!;
    await approveListing(db, approved.id, "nick", { now: t0 });

    withEbay({ sources: "ebay", override: gone });
    await scan(later(25)); // the approval expires here
    expect(byItem("285600000401")).toMatchObject({ status: "expired" });
    expect(byItem("285600000401")?.checkoutExpiredAt).toEqual(later(25));

    await scan(later(25 + 6 * 24));
    expect(confirmCheckout(db, approved.id, "nick", { now: later(25 + 6 * 24) }).ok).toBe(true);
    expect(byItem("285600000401")?.status).toBe("purchased");
  });

  it("drops an expired approval nobody came back for", async () => {
    await scan(t0);
    const approved = byItem("285600000401")!;
    await approveListing(db, approved.id, "nick", { now: t0 });
    withEbay({ sources: "ebay", override: gone });
    await scan(later(25));
    await scan(later(25 + 8 * 24));
    expect(byItem("285600000401")).toBeUndefined();
  });

  it("never deletes mock listings", async () => {
    withEbay({ sources: "all" });
    await scan(t0);
    const mocks = db.select().from(listings).all().filter((l) => l.sourceId.startsWith("mock-")).length;
    expect(mocks).toBeGreaterThan(0);

    vi.stubEnv("LINEN_SOURCES", "ebay");
    withEbay({ sources: "ebay", override: gone });
    await scan(later(48));
    const left = db.select().from(listings).where(inArray(listings.sourceId, ["ebay"])).all();
    expect(left).toHaveLength(0);
    expect(db.select().from(listings).all().filter((l) => l.sourceId.startsWith("mock-")).length).toBe(mocks);
  });
});

describe("remembering what was skipped", () => {
  const t0 = new Date(2026, 8, 16, 9, 0, 0);
  const days = (n: number) => new Date(t0.getTime() + n * 24 * 60 * 60 * 1000);
  const gone: Override = (call) => (call.url.pathname.endsWith("/item_summary/search") ? json(emptySearch) : undefined);

  beforeEach(() => withEbay({ sources: "ebay" }));

  /** Skip a listing, let eBay stop showing it until its row is cleaned up, then have it come back. */
  async function skipThenForget(legacyId: string) {
    await scan(t0);
    const l = byItem(legacyId)!;
    expect(l.status).toBe("pending");
    expect(rejectListing(db, l.id, "nick", { now: t0 }).ok).toBe(true);

    withEbay({ sources: "ebay", override: gone });
    await scan(days(2));
    expect(byItem(legacyId)).toBeUndefined();
    withEbay({ sources: "ebay" });
  }

  it("keeps the item id and the time, and nothing else", async () => {
    await scan(t0);
    rejectListing(db, byItem("285600000102")!.id, "nick", { now: t0 });
    expect(db.select().from(skippedItems).all()).toEqual([
      { sourceId: "ebay", externalId: "v1|285600000102|0", skippedAt: t0 },
    ]);
  });

  it("doesn't queue a skipped listing again when it comes back", async () => {
    await skipThenForget("285600000102");

    const r = await scan(days(3));
    // Everything else in the search comes back as new and is queued; the skipped one isn't.
    expect(r).toMatchObject({ queued: 5 });
    expect(byItem("285600000102")).toMatchObject({
      status: "rejected",
      note: "Skipped on Sep 16, so it wasn't queued again",
      decidedBy: "system",
    });
    expect(db.select().from(notifications).all().at(-1)?.body).toMatch(/5 finds need your OK/);
  });

  it("keeps saying no for as long as the listing keeps coming back", async () => {
    await skipThenForget("285600000102");
    await scan(days(3));
    withEbay({ sources: "ebay", override: gone });
    await scan(days(5)); // cleaned up again
    withEbay({ sources: "ebay" });
    await scan(days(6));
    expect(byItem("285600000102")?.status).toBe("rejected");
  });

  it("forgets after 30 days", async () => {
    await skipThenForget("285600000102");
    await scan(days(31));
    expect(byItem("285600000102")?.status).toBe("pending");
    expect(db.select().from(skippedItems).all()).toEqual([]);
  });

  it("uses the number of days from Settings", async () => {
    db.update(settings).set({ skipSuppressionDays: 5 }).run();
    await skipThenForget("285600000102");
    await scan(days(4));
    expect(byItem("285600000102")?.status).toBe("rejected");

    withEbay({ sources: "ebay", override: gone });
    await scan(days(6));
    withEbay({ sources: "ebay" });
    await scan(days(7));
    expect(byItem("285600000102")?.status).toBe("pending");
  });

  it("only remembers a Skip, not a Didn't buy", async () => {
    await scan(t0);
    const l = byItem("285600000102")!;
    await approveListing(db, l.id, "nick", { now: t0 });
    rejectListing(db, l.id, "nick", { now: t0 });
    expect(db.select().from(skippedItems).all()).toEqual([]);
  });

  it("doesn't record skips for mock sources, whose rows are never cleaned up", async () => {
    withEbay({ sources: "mock" });
    for (let i = 0; i < 6; i++) await runScan(db, { trigger: "manual", rng: seeded(40 + i) });
    const l = db.select().from(listings).where(eq(listings.status, "pending")).all()[0];
    expect(rejectListing(db, l.id, "nick").ok).toBe(true);
    expect(db.select().from(skippedItems).all()).toEqual([]);
  });
});

describe("the daily eBay call limit", () => {
  // 10:00 on a Wednesday in Nashville.
  const morning = new Date("2026-09-16T15:00:00Z");
  const at = (iso: string) => new Date(iso);
  const used = (now: Date) => callsOn(db, "ebay", now).calls;
  const limitMessage =
    "eBay: Reached today's limit of 12 eBay calls, so eBay isn't being scanned until midnight Central. Everything else carries on. The limit is in Settings.";

  beforeEach(() => {
    withEbay({ sources: "ebay" });
    db.update(settings).set({ ebayDailyCallBudget: 12 }).run();
  });

  it("defaults to 4,000 a day", () => {
    expect(openDb(":memory:").select().from(settings).get()?.ebayDailyCallBudget).toBe(4000);
  });

  it("counts a day as a day in Central time", () => {
    expect(callDay(at("2026-09-16T15:00:00Z"))).toBe("2026-09-16");
    expect(callDay(at("2026-09-17T04:59:00Z"))).toBe("2026-09-16"); // 11:59 pm in Nashville
    expect(callDay(at("2026-09-17T05:00:00Z"))).toBe("2026-09-17"); // midnight
    expect(callDay(at("2026-12-17T05:59:00Z"))).toBe("2026-12-16"); // winter: an hour further from UTC
  });

  it("counts every call to eBay, across scans", async () => {
    await scan(morning);
    expect(used(morning)).toBe(9); // 7 searches + 2 shipping lookups
    expect(ebay.browseCalls()).toHaveLength(9);
  });

  it("stops at the limit, mid-scan, and says so once in the scan log", async () => {
    await scan(morning); // 9 of 12
    const second = await scan(at("2026-09-16T15:15:00Z"));
    expect(used(morning)).toBe(12);
    expect(ebay.browseCalls()).toHaveLength(12);
    expect(!second.skipped && second.errors).toEqual([limitMessage]);
    expect(db.select().from(events).where(eq(events.type, "error")).all().map((e) => e.message)).toEqual([limitMessage]);
  });

  it("makes no calls at all once the limit is reached, and doesn't repeat the alarm", async () => {
    await scan(morning);
    await scan(at("2026-09-16T15:15:00Z"));
    const calls = ebay.calls.length;

    const third = await scan(at("2026-09-16T15:30:00Z"));
    expect(ebay.calls).toHaveLength(calls);
    expect(third).toMatchObject({ sourcesChecked: 0, errors: [] });
    expect(db.select().from(events).where(eq(events.type, "error")).all()).toHaveLength(1);
    // Still there in the scan's own line in the activity feed.
    expect(db.select().from(events).where(eq(events.type, "scan")).all().at(-1)?.message).toMatch(
      /eBay not scanned \(daily call limit reached\)/,
    );
  });

  it("covers the worker and Scan now alike: they draw on the same count", async () => {
    await runScan(db, { trigger: "worker", now: morning, rng: seeded(3) }); // 9
    await runScan(db, { trigger: "manual", now: at("2026-09-16T15:05:00Z"), rng: seeded(3) }); // 3 more, then stopped
    const calls = ebay.browseCalls().length;
    expect(calls).toBe(12);

    for (const trigger of ["worker", "manual"] as const) {
      await runScan(db, { trigger, now: at("2026-09-16T16:00:00Z"), rng: seeded(3) });
    }
    expect(ebay.browseCalls()).toHaveLength(calls);
    expect(used(morning)).toBe(12);
  });

  it("holds across two connections to the same database", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "linen-watch-calls-"));
    try {
      const web = openDb(path.join(dir, "test.db"));
      const worker = openDb(path.join(dir, "test.db"));
      web.update(settings).set({ ebayDailyCallBudget: 12 }).run();
      await runScan(worker, { trigger: "worker", now: morning, rng: seeded(3) });
      await runScan(web, { trigger: "manual", now: at("2026-09-16T15:05:00Z"), rng: seeded(3) });
      await runScan(worker, { trigger: "worker", now: at("2026-09-16T15:20:00Z"), rng: seeded(3) });
      expect(ebay.browseCalls()).toHaveLength(12);
      expect(callsOn(web, "ebay", morning).calls).toBe(12);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("counts retries, which are real calls", async () => {
    let first = true;
    withEbay({
      sources: "ebay",
      override: (call) => {
        if (!call.url.pathname.endsWith("/item_summary/search") || !first) return undefined;
        first = false;
        return json({ errors: [{ message: "Too many requests." }] }, 429);
      },
    });
    db.update(settings).set({ ebayDailyCallBudget: 4000 }).run();
    await scan(morning);
    expect(used(morning)).toBe(10);
  });

  it("starts again the next day", async () => {
    await scan(morning);
    await scan(at("2026-09-16T15:15:00Z"));
    const before = ebay.browseCalls().length;

    const late = await scan(at("2026-09-17T04:50:00Z")); // 11:50 pm, same day in Nashville
    expect(late).toMatchObject({ sourcesChecked: 0 });
    expect(ebay.browseCalls()).toHaveLength(before);

    const next = await scan(at("2026-09-17T05:10:00Z")); // ten past midnight
    expect(next).toMatchObject({ sourcesChecked: 1, errors: [] });
    expect(used(at("2026-09-17T05:10:00Z"))).toBe(9);
    expect(db.select().from(apiCalls).all()).toHaveLength(2);
  });

  it("leaves the mock sources running when eBay is stopped", async () => {
    withEbay({ sources: "all" });
    db.update(settings).set({ ebayDailyCallBudget: 1 }).run();
    await scan(morning);
    const r = await scan(at("2026-09-16T15:15:00Z"));
    expect(r).toMatchObject({ sourcesChecked: 4 });
  });

  it("never counts the mock sources", async () => {
    withEbay({ sources: "mock" });
    await scan(morning);
    expect(db.select().from(apiCalls).all()).toEqual([]);
  });

  it("applies a lowered limit right away", async () => {
    db.update(settings).set({ ebayDailyCallBudget: 4000 }).run();
    await scan(morning); // 9 used
    db.update(settings).set({ ebayDailyCallBudget: 5 }).run();
    const r = await scan(at("2026-09-16T15:15:00Z"));
    expect(ebay.browseCalls()).toHaveLength(9);
    expect(!r.skipped && r.errors).toEqual([limitMessage.replace("12", "5")]);
  });
});

describe("cleanup of blocked listings", () => {
  const t0 = new Date(2026, 8, 16, 9, 0, 0);
  const later = (h: number) => new Date(t0.getTime() + h * 60 * 60 * 1000);

  it("clears eBay listings the guardrails blocked, once they've gone unseen for 24 hours", async () => {
    withEbay({ sources: "ebay" });
    // A $96 lot can't fit under a $50 per-order cap.
    db.update(settings).set({ perOrderCapCents: 5000 }).run();
    await scan(t0);
    expect(byItem("285600000101")?.status).toBe("blocked");

    withEbay({
      sources: "ebay",
      override: (call) => (call.url.pathname.endsWith("/item_summary/search") ? json(emptySearch) : undefined),
    });
    await scan(later(23));
    expect(byItem("285600000101")?.status).toBe("blocked");
    await scan(later(25));
    expect(byItem("285600000101")).toBeUndefined();
  });
});
