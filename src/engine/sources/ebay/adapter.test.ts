import { describe, expect, it } from "vitest";
import { SEED_SPECS } from "@/db/seed";
import error429 from "./__fixtures__/error-429.json";
import { fakeEbay, json, TEST_KEYS, type Override } from "./__fixtures__/fake-ebay";
import tokenError from "./__fixtures__/token-error.json";
import type { FetchContext, SearchSpec } from "../types";
import { createEbayAdapter, planSearches } from "./adapter";
import { createTokenProvider, readCredentials } from "./auth";
import { EBAY_CALLS_PER_SCAN, EBAY_MAX_SHIPPING_LOOKUPS } from "./config";

const specs: SearchSpec[] = SEED_SPECS.map((s, i) => ({
  id: i + 1,
  name: s.name,
  category: s.category,
  size: s.size ?? null,
  color: s.color ?? "white",
  materials: s.materials,
  minThreadCount: s.minThreadCount ?? null,
  conditions: s.conditions,
  maxUnitPriceCents: s.maxUnitPriceCents,
  maxUnitsPerOrder: s.maxUnitsPerOrder,
  targetUnits: s.targetUnits,
  active: true,
}));

function setup(override?: Override, withSpecs = specs) {
  const ebay = fakeEbay(override);
  const warnings: string[] = [];
  const adapter = createEbayAdapter({
    env: TEST_KEYS,
    fetch: ebay.fetch,
    sleep: async () => {},
    tokens: createTokenProvider(readCredentials(TEST_KEYS)!, { fetch: ebay.fetch }),
  });
  const ctx: FetchContext = {
    now: new Date(),
    rng: () => 0.5,
    specs: withSpecs,
    shipToZip: "37203",
    perOrderCapCents: 30000,
    warn: (m) => warnings.push(m),
  };
  return { ebay, adapter, ctx, warnings };
}

describe("planSearches", () => {
  it("plans one search per active spec", () => {
    const plan = planSearches(specs, 30000);
    expect(plan.map((p) => [p.q, p.categoryId])).toEqual([
      ["white queen flat sheet", "20460"],
      ["white queen fitted sheet", "20460"],
      ["white king fitted sheet", "20460"],
      ["white king flat sheet", "20460"],
      ["white standard pillowcase", "54257"],
      ["white bath towel", "40587"],
    ]);
  });

  it("asks only for US dollars, fixed price, the right conditions, shipped to and from the US", () => {
    const [sheets, , , , pillowcases] = planSearches(specs, 30000);
    // New only: eBay's "New" and nothing else.
    expect(sheets.filter).toBe(
      "price:[..300.00],priceCurrency:USD,buyingOptions:{FIXED_PRICE},conditionIds:{1000},deliveryCountry:US,itemLocationCountry:US",
    );
    // New or like new: adds "New other" and "Like New".
    expect(pillowcases.filter).toContain("conditionIds:{1000|1500|2750}");
  });

  it("caps the price at the most a lot could cost and still be bought", () => {
    // King fitted: $13.00 x 24 per order = $312, but no order may pass $300.
    expect(planSearches(specs, 30000)[2].filter).toContain("price:[..300.00]");
    // With a roomier order cap, the spec's own limit is what binds.
    expect(planSearches(specs, 100000)[2].filter).toContain("price:[..312.00]");
  });

  it("skips paused specs and shares a search between specs that would run the same one", () => {
    const [queenFlat] = specs;
    const plan = planSearches(
      [
        queenFlat,
        { ...queenFlat, id: 7, name: "Queen flat, like new", conditions: ["like_new"], maxUnitPriceCents: 500 },
        { ...specs[1], active: false },
      ],
      30000,
    );
    expect(plan).toHaveLength(1);
    expect(plan[0].specNames).toEqual(["Queen flat sheets", "Queen flat, like new"]);
    expect(plan[0].filter).toContain("conditionIds:{1000|1500|2750}");
  });

  it("uses keywords alone where we don't have a verified category", () => {
    const hand = { ...specs[5], category: "hand_towel", name: "Hand towels" };
    expect(planSearches([hand], 30000)[0]).toMatchObject({ q: "white hand towel", categoryId: null });
  });
});

describe("eBay adapter", () => {
  it("can't place orders: a person always checks out", () => {
    expect(createEbayAdapter().placeOrder).toBeUndefined();
  });

  it("runs one search per spec, plus further pages where there are any", async () => {
    const { ebay, adapter, ctx } = setup();
    await adapter.fetchListings(ctx);
    const asked = ebay.searches().map((c) => `${c.url.searchParams.get("q")}@${c.url.searchParams.get("offset")}`);
    expect(asked).toEqual([
      "white queen flat sheet@0",
      "white queen fitted sheet@0",
      "white king fitted sheet@0",
      "white king flat sheet@0",
      "white standard pillowcase@0",
      "white bath towel@0",
      "white queen flat sheet@200", // only this search had a next page
    ]);
  });

  it("never reads past the page cap, however many results there are", async () => {
    const { ebay, adapter, ctx } = setup((call) => {
      if (!call.url.pathname.endsWith("/item_summary/search")) return undefined;
      const offset = call.url.searchParams.get("offset");
      return json({
        next: "https://api.ebay.com/more",
        itemSummaries: [
          {
            itemId: `v1|${call.url.searchParams.get("q")}-${offset}|0`,
            title: "White Queen Flat Sheet Percale 300TC",
            itemWebUrl: "https://www.ebay.com/itm/1",
            price: { value: "8.00", currency: "USD" },
            buyingOptions: ["FIXED_PRICE"],
            conditionId: "1000",
            shippingOptions: [{ shippingCost: { value: "0.00", currency: "USD" } }],
          },
        ],
      });
    });
    const listings = await adapter.fetchListings(ctx);
    expect(ebay.searches()).toHaveLength(12); // 6 specs x 2 pages
    expect(listings).toHaveLength(12);
  });

  it("stores each listing once, even when several searches return it", async () => {
    const { adapter, ctx } = setup();
    const listings = await adapter.fetchListings(ctx);
    const ids = listings.map((l) => l.externalId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id === "v1|285600000102|0")).toHaveLength(1);
    expect(listings).toHaveLength(19);
  });

  it("drops auctions and prices that aren't in US dollars", async () => {
    const { adapter, ctx } = setup();
    const ids = (await adapter.fetchListings(ctx)).map((l) => l.externalId);
    expect(ids).not.toContain("v1|285600000110|0"); // auction with Buy It Now
    expect(ids).not.toContain("v1|285600000111|0"); // priced in CAD
  });

  it("maps a clean listing field by field", async () => {
    const { adapter, ctx } = setup();
    const listings = await adapter.fetchListings(ctx);
    expect(listings.find((l) => l.externalId === "v1|285600000101|0")).toEqual({
      externalId: "v1|285600000101|0",
      title: "Lot of 12 White Queen Flat Sheets T-250 Percale Hotel Linen New",
      url: "https://www.ebay.com/itm/285600000101",
      category: "flat_sheet",
      size: "queen",
      color: "white",
      material: "percale",
      threadCount: 250,
      condition: "new",
      lotPriceCents: 9600,
      lotSize: 12,
      lotsAvailable: 1,
      shippingCents: 1200,
      parseIssues: [],
    });
  });

  it("flags what it can't be sure of instead of guessing", async () => {
    const { adapter, ctx } = setup();
    const listings = await adapter.fetchListings(ctx);
    const issues = (legacyId: string) =>
      listings.find((l) => l.externalId === `v1|${legacyId}|0`)?.parseIssues?.map((i) => `${i.field}: ${i.reason}`);

    expect(issues("285600000103")).toEqual(["category: it's a sheet set, not a single kind of item"]);
    expect(issues("285600000106")).toEqual([
      "listing: the listing covers several options (sizes or colors) and the price is for only one of them",
    ]);
    expect(issues("285600000109")).toEqual(["condition: it's sold for parts or not working"]);
    expect(issues("285600000112")).toEqual(["size: the title lists more than one size (full, queen)"]);
    expect(issues("285600000113")).toEqual([
      "lotSize: it looks like a multi-pack, but the count isn't in the title",
      "shipping: shipping cost isn't listed",
    ]);
  });

  it("maps eBay's condition ids", async () => {
    const { adapter, ctx } = setup();
    const listings = await adapter.fetchListings(ctx);
    const condition = (legacyId: string) => listings.find((l) => l.externalId === `v1|${legacyId}|0`)?.condition;
    expect(condition("285600000107")).toBe("like_new"); // New other
    expect(condition("285600000108")).toBe("used");
    expect(condition("285600000403")).toBe("like_new"); // Like New
    expect(condition("285600000109")).toBeNull(); // For parts
  });

  it("never carries seller details into a listing", async () => {
    const { adapter, ctx } = setup();
    const listings = await adapter.fetchListings(ctx);
    const stored = JSON.stringify(listings);
    expect(stored).not.toMatch(/fixture_seller|seller|feedback/i);
    for (const l of listings) {
      expect(Object.keys(l).sort()).toEqual(
        [
          "category", "color", "condition", "externalId", "lotPriceCents", "lotSize", "lotsAvailable",
          "material", "parseIssues", "shippingCents", "size", "threadCount", "title", "url",
        ],
      );
    }
  });

  describe("shipping the search didn't give", () => {
    it("is looked up when it's the only thing in the way of a match", async () => {
      const { ebay, adapter, ctx } = setup();
      const listings = await adapter.fetchListings(ctx);
      expect(ebay.lookups().map((c) => decodeURIComponent(c.url.pathname.split("/").pop()!)).sort()).toEqual([
        "v1|285600000105|0",
        "v1|285600000403|0",
      ]);
      // Found: the cheapest option, and the issue is cleared.
      expect(listings.find((l) => l.externalId === "v1|285600000105|0")).toMatchObject({
        shippingCents: 840,
        parseIssues: [],
      });
    });

    it("stays unknown, and says so, when eBay still doesn't give it", async () => {
      const { adapter, ctx } = setup();
      const listings = await adapter.fetchListings(ctx);
      expect(listings.find((l) => l.externalId === "v1|285600000403|0")).toMatchObject({
        shippingCents: null,
        parseIssues: [{ field: "shipping", reason: "shipping cost isn't listed" }],
      });
    });

    it("isn't looked up for listings that couldn't match anyway", async () => {
      const { ebay, adapter, ctx } = setup();
      await adapter.fetchListings(ctx);
      // The bulk lot has no shipping either, but its count is unknown too.
      expect(ebay.lookups().some((c) => c.url.pathname.includes("285600000113"))).toBe(false);
    });

    it("is capped per scan", async () => {
      const many = Array.from({ length: 30 }, (_, i) => ({
        itemId: `v1|9000000${String(i).padStart(2, "0")}|0`,
        title: "White Queen Flat Sheet Percale 300TC",
        itemWebUrl: `https://www.ebay.com/itm/9000000${i}`,
        price: { value: "8.00", currency: "USD" },
        buyingOptions: ["FIXED_PRICE"],
        conditionId: "1000",
        shippingOptions: [{ shippingCostType: "CALCULATED" }],
      }));
      const { ebay, adapter, ctx } = setup((call) =>
        call.url.searchParams.get("q") === "white queen flat sheet" ? json({ itemSummaries: many }) : undefined,
      );
      await adapter.fetchListings(ctx);
      expect(ebay.lookups()).toHaveLength(EBAY_MAX_SHIPPING_LOOKUPS);
    });
  });

  describe("when things go wrong", () => {
    it("fails with one clear message when the keys are missing", async () => {
      const adapter = createEbayAdapter({ env: {} });
      const { ctx } = setup();
      await expect(adapter.fetchListings(ctx)).rejects.toThrow(/eBay API keys are missing/);
    });

    it("fails once, not once per search, when eBay rejects the keys", async () => {
      const { ebay, adapter, ctx, warnings } = setup((call) =>
        call.url.pathname.endsWith("/oauth2/token") ? json(tokenError, 401) : undefined,
      );
      await expect(adapter.fetchListings(ctx)).rejects.toThrow(/eBay sign-in failed/);
      expect(ebay.searches()).toHaveLength(0);
      expect(warnings).toEqual([]);
    });

    it("carries on with the other searches when one fails", async () => {
      const { adapter, ctx, warnings } = setup((call) =>
        call.url.searchParams.get("q") === "white bath towel" ? json({ errors: [{ message: "Bad category" }] }, 400) : undefined,
      );
      const listings = await adapter.fetchListings(ctx);
      expect(listings).toHaveLength(16); // everything but the three towels
      expect(warnings).toEqual(['Search "white bath towel": eBay said HTTP 400 (Bad category). Skipped for this scan.']);
    });

    it("reports every search that eBay kept refusing", async () => {
      const { ebay, adapter, ctx, warnings } = setup((call) =>
        call.url.pathname.startsWith("/buy/browse/") ? json(error429, 429) : undefined,
      );
      expect(await adapter.fetchListings(ctx)).toEqual([]);
      expect(ebay.browseCalls()).toHaveLength(18); // 6 searches x 3 attempts
      expect(warnings).toHaveLength(6);
      expect(warnings[0]).toBe('Search "white queen flat sheet": eBay said HTTP 429 (The request limit has been reached for the resource.). Skipped for this scan.');
    });

    it("stops at the call budget, keeps what it has, and says results were left unread", async () => {
      // Every search has more pages, and eBay refuses each request once before
      // answering: two calls per page. Page 1 of six searches uses 12 calls,
      // leaving 8 for page 2.
      const attempts = new Map<string, number>();
      const { ebay, adapter, ctx, warnings } = setup((call) => {
        if (!call.url.pathname.endsWith("/item_summary/search")) return undefined;
        const n = (attempts.get(call.url.href) ?? 0) + 1;
        attempts.set(call.url.href, n);
        if (n === 1) return json(error429, 429);
        return json({
          next: "https://api.ebay.com/more",
          itemSummaries: [
            {
              itemId: `v1|${call.url.searchParams.get("q")}-${call.url.searchParams.get("offset")}|0`,
              title: "White Queen Flat Sheet Percale 300TC",
              itemWebUrl: "https://www.ebay.com/itm/1",
              price: { value: "8.00", currency: "USD" },
              buyingOptions: ["FIXED_PRICE"],
              conditionId: "1000",
              shippingOptions: [{ shippingCost: { value: "0.00", currency: "USD" } }],
            },
          ],
        });
      });
      const listings = await adapter.fetchListings(ctx);
      expect(ebay.browseCalls()).toHaveLength(EBAY_CALLS_PER_SCAN);
      expect(listings).toHaveLength(10); // page 1 of all six, page 2 of four
      expect(warnings).toEqual([
        "Stopped at 20 calls for this scan, so some results weren't read. The rest will be picked up on later scans.",
      ]);
    });
  });
});
