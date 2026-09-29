import emptySearch from "./search-empty.json";
import itemNoShipping from "./item-compact-no-shipping.json";
import itemWithShipping from "./item-compact-with-shipping.json";
import pillowcases from "./search-pillowcases.json";
import sheetsPage1 from "./search-sheets-page1.json";
import sheetsPage2 from "./search-sheets-page2.json";
import token from "./token.json";
import towels from "./search-towels.json";

/** A stand-in for eBay that answers from the saved fixtures and remembers what it was asked. */

export interface Call {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: string | null;
}

export type Override = (call: Call) => Response | undefined | Promise<Response | undefined>;

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const SEARCHES: Record<string, unknown> = {
  "white queen flat sheet@0": sheetsPage1,
  "white queen flat sheet@200": sheetsPage2,
  "white standard pillowcase@0": pillowcases,
  "white bath towel@0": towels,
};

const ITEMS: Record<string, unknown> = {
  "v1|285600000105|0": itemWithShipping,
  "v1|285600000403|0": itemNoShipping,
};

export function fakeEbay(override?: Override) {
  const calls: Call[] = [];

  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const call: Call = {
      method: init?.method ?? "GET",
      url,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: typeof init?.body === "string" ? init.body : null,
    };
    calls.push(call);

    const custom = await override?.(call);
    if (custom) return custom;

    if (url.pathname === "/identity/v1/oauth2/token") return json(token);
    if (url.pathname === "/buy/browse/v1/item_summary/search") {
      const key = `${url.searchParams.get("q")}@${url.searchParams.get("offset")}`;
      return json(SEARCHES[key] ?? emptySearch);
    }
    if (url.pathname.startsWith("/buy/browse/v1/item/")) {
      const id = decodeURIComponent(url.pathname.split("/").pop() ?? "");
      return id in ITEMS ? json(ITEMS[id]) : json({ errors: [{ errorId: 11001, message: "The item was not found." }] }, 404);
    }
    return json({ errors: [{ message: `No fixture for ${url.pathname}` }] }, 404);
  }) as typeof globalThis.fetch;

  return {
    fetch,
    calls,
    /** Calls that count against eBay's Browse limit (everything but sign-in). */
    browseCalls: () => calls.filter((c) => c.url.pathname.startsWith("/buy/browse/")),
    searches: () => calls.filter((c) => c.url.pathname.endsWith("/item_summary/search")),
    lookups: () => calls.filter((c) => c.url.pathname.startsWith("/buy/browse/v1/item/")),
    signIns: () => calls.filter((c) => c.url.pathname === "/identity/v1/oauth2/token"),
  };
}

export const TEST_KEYS = {
  EBAY_CLIENT_ID: "TestApp-LinenWat-SBX-0000",
  EBAY_CLIENT_SECRET: "SBX-super-secret-value",
  EBAY_ENV: "sandbox",
};
