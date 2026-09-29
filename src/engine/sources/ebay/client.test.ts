import { describe, expect, it } from "vitest";
import error400 from "./__fixtures__/error-400-filter.json";
import error429 from "./__fixtures__/error-429.json";
import { fakeEbay, json, TEST_KEYS, type Override } from "./__fixtures__/fake-ebay";
import { createTokenProvider, readCredentials } from "./auth";
import { BudgetExhausted, CallBudget, createEbayClient, endUserContext, type SearchParams } from "./client";

const creds = readCredentials(TEST_KEYS)!;

const SEARCH: SearchParams = {
  q: "white queen flat sheet",
  categoryId: "20460",
  filter: "price:[..300.00],priceCurrency:USD,buyingOptions:{FIXED_PRICE},conditionIds:{1000},deliveryCountry:US,itemLocationCountry:US",
  sort: "newlyListed",
  limit: 200,
  offset: 0,
};

function setup(override?: Override, limit = 20) {
  const ebay = fakeEbay(override);
  const waits: number[] = [];
  const budget = new CallBudget(limit);
  const client = createEbayClient({
    creds,
    tokens: createTokenProvider(creds, { fetch: ebay.fetch }),
    budget,
    shipToZip: "37203",
    fetch: ebay.fetch,
    sleep: async (ms) => void waits.push(ms),
    rng: () => 0,
  });
  return { ebay, client, budget, waits };
}

/** Fail the first `n` Browse calls with `response`, then behave. */
const failFirst = (n: number, response: () => Response): Override => {
  let seen = 0;
  return (call) => (call.url.pathname.startsWith("/buy/browse/") && seen++ < n ? response() : undefined);
};

describe("search request", () => {
  it("sends the query, filters and paging eBay expects, URL-encoded", async () => {
    const { ebay, client } = setup();
    const page = await client.search(SEARCH);
    expect(page.itemSummaries?.length).toBeGreaterThan(5);

    const [call] = ebay.searches();
    expect(call.url.origin + call.url.pathname).toBe("https://api.sandbox.ebay.com/buy/browse/v1/item_summary/search");
    expect(Object.fromEntries(call.url.searchParams)).toEqual({
      q: "white queen flat sheet",
      category_ids: "20460",
      filter: SEARCH.filter,
      sort: "newlyListed",
      limit: "200",
      offset: "0",
    });
    // Braces, brackets, pipes and spaces must not go out raw.
    expect(call.url.href).not.toMatch(/[ {}|[\]]/);
    expect(call.url.href).toContain("q=white%20queen%20flat%20sheet");
  });

  it("identifies the marketplace and where the order ships", async () => {
    const { ebay, client } = setup();
    await client.search(SEARCH);
    const { headers } = ebay.searches()[0];
    expect(headers.authorization).toBe("Bearer v^1.1#i^1#fixture-token-not-real");
    expect(headers["x-ebay-c-marketplace-id"]).toBe("EBAY_US");
    expect(headers["x-ebay-c-enduserctx"]).toBe("contextualLocation=country%3DUS%2Czip%3D37203");
    expect(endUserContext("37203")).toBe("contextualLocation=country%3DUS%2Czip%3D37203");
  });

  it("leaves the category out when we don't have a verified one", async () => {
    const { ebay, client } = setup();
    await client.search({ ...SEARCH, categoryId: null });
    expect(ebay.searches()[0].url.searchParams.has("category_ids")).toBe(false);
  });

  it("looks items up by id, asking only for the compact fields", async () => {
    const { ebay, client } = setup();
    const item = await client.getItem("v1|285600000105|0");
    expect(item.shippingOptions?.[0].shippingCost?.value).toBe("8.40");
    expect(ebay.lookups()[0].url.href).toBe(
      "https://api.sandbox.ebay.com/buy/browse/v1/item/v1%7C285600000105%7C0?fieldgroups=COMPACT",
    );
  });
});

describe("retries", () => {
  it("waits and tries again when eBay says slow down (429)", async () => {
    const { ebay, client, waits } = setup(failFirst(2, () => json(error429, 429)));
    const page = await client.search(SEARCH);
    expect(page.itemSummaries?.length).toBeGreaterThan(0);
    expect(ebay.searches()).toHaveLength(3);
    expect(waits).toEqual([500, 1000]); // backing off
  });

  it("waits as long as eBay asks, within reason", async () => {
    const { client, waits } = setup(failFirst(1, () => json(error429, 429, { "retry-after": "3" })));
    await client.search(SEARCH);
    expect(waits).toEqual([3000]);

    const long = setup(failFirst(1, () => json(error429, 429, { "retry-after": "600" })));
    await long.client.search(SEARCH);
    expect(long.waits).toEqual([8000]);
  });

  it("tries again on a server error (5xx), then gives up with a clear message", async () => {
    const { ebay, client } = setup(failFirst(99, () => json({ errors: [{ message: "Internal error" }] }, 503)));
    await expect(client.search(SEARCH)).rejects.toThrow(
      'Search "white queen flat sheet": eBay said HTTP 503 (Internal error)',
    );
    expect(ebay.searches()).toHaveLength(3);
  });

  it("tries again when the request times out or the connection drops", async () => {
    let first = true;
    const { ebay, client } = setup((call) => {
      if (!call.url.pathname.startsWith("/buy/browse/") || !first) return undefined;
      first = false;
      throw new DOMException("The operation timed out.", "TimeoutError");
    });
    await expect(client.search(SEARCH)).resolves.toBeTruthy();
    expect(ebay.searches()).toHaveLength(2);
  });

  it("reports a timeout in plain words when it never gets through", async () => {
    const { client } = setup((call) => {
      if (!call.url.pathname.startsWith("/buy/browse/")) return undefined;
      throw new DOMException("The operation timed out.", "TimeoutError");
    });
    await expect(client.search(SEARCH)).rejects.toThrow(/couldn't reach eBay \(timed out\)/);
  });

  it("doesn't retry a request eBay says is wrong (4xx)", async () => {
    const { ebay, client, waits } = setup(failFirst(99, () => json(error400, 400)));
    await expect(client.search(SEARCH)).rejects.toThrow(/HTTP 400 \(The 'price' filter requires the 'priceCurrency' filter\.\)/);
    expect(ebay.searches()).toHaveLength(1);
    expect(waits).toEqual([]);
  });

  it("signs in again once if eBay rejects the token", async () => {
    const { ebay, client } = setup(failFirst(1, () => json({ errors: [{ message: "Invalid access token" }] }, 401)));
    await expect(client.search(SEARCH)).resolves.toBeTruthy();
    expect(ebay.signIns()).toHaveLength(2);
    expect(ebay.searches()).toHaveLength(2);
  });
});

describe("call budget", () => {
  it("stops before going over", async () => {
    const { ebay, client, budget } = setup(undefined, 2);
    await client.search(SEARCH);
    await client.getItem("v1|285600000105|0");
    await expect(client.search(SEARCH)).rejects.toBeInstanceOf(BudgetExhausted);
    expect(ebay.browseCalls()).toHaveLength(2);
    expect(budget.remaining).toBe(0);
  });

  it("counts retries, since each one is a real call to eBay", async () => {
    const { ebay, client, budget } = setup(failFirst(99, () => json(error429, 429)), 2);
    await expect(client.search(SEARCH)).rejects.toBeInstanceOf(BudgetExhausted);
    expect(ebay.browseCalls()).toHaveLength(2);
    expect(budget.used).toBe(2);
  });

  it("doesn't count signing in, which has its own limit at eBay", async () => {
    const { client, budget } = setup();
    await client.search(SEARCH);
    expect(budget.used).toBe(1);
  });
});
