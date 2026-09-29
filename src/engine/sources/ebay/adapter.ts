import { findMatch } from "../../match";
import { EBAY_SOURCE_ID } from "../selection";
import type { FetchContext, RawListing, SearchSpec, SourceAdapter } from "../types";
import { readCredentials, tokenProviderFor, type TokenProvider } from "./auth";
import { BudgetExhausted, CallBudget, createEbayClient, type SearchParams } from "./client";
import {
  EBAY_CALLS_PER_SCAN,
  EBAY_CATEGORY_IDS,
  EBAY_MAX_PAGES,
  EBAY_MAX_SHIPPING_LOOKUPS,
  EBAY_PAGE_SIZE,
  ebayConditionIds,
} from "./config";
import { shippingCents, toRawListing } from "./parse";
import type { EbayItemSummary } from "./types";

/**
 * eBay, read-only. One search per active spec through the Browse API, results
 * parsed into listings. There is no placeOrder: eBay's ordering API is for
 * approved partners only, so a person always checks out in the eBay app.
 */

const SIZE_WORDS: Record<string, string> = {
  twin: "twin",
  full: "full",
  queen: "queen",
  king: "king",
  standard: "standard",
  king_pillow: "king",
};

const CATEGORY_WORDS: Record<string, string> = {
  flat_sheet: "flat sheet",
  fitted_sheet: "fitted sheet",
  pillowcase: "pillowcase",
  duvet_cover: "duvet cover",
  bath_towel: "bath towel",
  hand_towel: "hand towel",
};

export interface PlannedSearch {
  q: string;
  categoryId: string | null;
  filter: string;
  /** The specs this search is for, for messages. */
  specNames: string[];
}

/**
 * One search per spec. Material and thread count are left out of the search
 * and judged from the title instead, so an oddly worded listing isn't hidden.
 * Specs that would run the same search share one.
 */
export function planSearches(specs: SearchSpec[], perOrderCapCents: number): PlannedSearch[] {
  const byQuery = new Map<
    string,
    { q: string; categoryId: string | null; conditions: Set<string>; maxCents: number; specNames: string[] }
  >();

  for (const spec of specs) {
    if (!spec.active) continue;
    const item = CATEGORY_WORDS[spec.category];
    if (!item) continue;
    const size = spec.size ? SIZE_WORDS[spec.size] : null;
    const q = [spec.color, size, item].filter(Boolean).join(" ");
    const categoryId = EBAY_CATEGORY_IDS[spec.category as keyof typeof EBAY_CATEGORY_IDS] ?? null;
    // The most one lot could cost and still be bought for this spec.
    const maxCents = Math.min(perOrderCapCents, spec.maxUnitPriceCents * spec.maxUnitsPerOrder);

    const key = `${q}|${categoryId}`;
    const planned = byQuery.get(key) ?? { q, categoryId, conditions: new Set<string>(), maxCents: 0, specNames: [] };
    for (const c of spec.conditions) planned.conditions.add(c);
    planned.maxCents = Math.max(planned.maxCents, maxCents);
    planned.specNames.push(spec.name);
    byQuery.set(key, planned);
  }

  return [...byQuery.values()].map(({ q, categoryId, conditions, maxCents, specNames }) => {
    const conditionIds = ebayConditionIds([...conditions]);
    const filter = [
      `price:[..${(maxCents / 100).toFixed(2)}]`,
      "priceCurrency:USD",
      "buyingOptions:{FIXED_PRICE}",
      conditionIds.length ? `conditionIds:{${conditionIds.join("|")}}` : null,
      "deliveryCountry:US",
      "itemLocationCountry:US",
    ]
      .filter(Boolean)
      .join(",");
    return { q, categoryId, filter, specNames };
  });
}

export interface EbayAdapterDeps {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  tokens?: TokenProvider;
}

export function createEbayAdapter(deps: EbayAdapterDeps = {}): SourceAdapter {
  return {
    id: EBAY_SOURCE_ID,

    async fetchListings(ctx: FetchContext): Promise<RawListing[]> {
      const creds = readCredentials(deps.env ?? process.env);
      if (!creds) throw new Error("eBay API keys are missing (EBAY_CLIENT_ID, EBAY_CLIENT_SECRET)");

      const tokens = deps.tokens ?? tokenProviderFor(creds);
      const budget = new CallBudget(EBAY_CALLS_PER_SCAN);
      const client = createEbayClient({
        creds,
        tokens,
        budget,
        shipToZip: ctx.shipToZip,
        fetch: deps.fetch,
        sleep: deps.sleep,
        rng: ctx.rng,
      });

      // Sign in once up front: bad keys should fail the source with one clear
      // message, not once per search.
      await tokens.getToken();

      const found = new Map<string, EbayItemSummary>();
      let open = planSearches(ctx.specs, ctx.perOrderCapCents);
      let outOfBudget = false;

      // Page 1 of every search before page 2 of any, so a tight budget still
      // covers every spec.
      for (let page = 0; page < EBAY_MAX_PAGES && open.length > 0 && !outOfBudget; page++) {
        const more: PlannedSearch[] = [];
        for (const search of open) {
          const params: SearchParams = {
            q: search.q,
            categoryId: search.categoryId,
            filter: search.filter,
            sort: "newlyListed",
            limit: EBAY_PAGE_SIZE,
            offset: page * EBAY_PAGE_SIZE,
          };
          try {
            const result = await client.search(params);
            const items = result.itemSummaries ?? [];
            for (const item of items) {
              if (item.itemId && !found.has(item.itemId)) found.set(item.itemId, item);
            }
            if (result.next) more.push(search);
          } catch (err) {
            if (err instanceof BudgetExhausted) {
              outOfBudget = true;
              break;
            }
            ctx.warn(`${err instanceof Error ? err.message : String(err)}. Skipped for this scan.`);
          }
        }
        open = more;
      }

      const listings: RawListing[] = [];
      for (const item of found.values()) {
        const parsed = toRawListing(item);
        if (parsed.ok) listings.push(parsed.listing);
      }

      // Shipping the search didn't give: look the item up, but only where
      // shipping is the one thing standing between the listing and a match.
      const needShipping = shuffle(listings.filter((l) => onlyMissingShipping(l, ctx.specs)), ctx.rng);
      let lookups = 0;
      for (const listing of needShipping) {
        if (lookups >= EBAY_MAX_SHIPPING_LOOKUPS || outOfBudget) break;
        lookups++;
        try {
          const item = await client.getItem(listing.externalId);
          const cents = shippingCents(item.shippingOptions);
          if (cents != null) {
            listing.shippingCents = cents;
            listing.parseIssues = (listing.parseIssues ?? []).filter((i) => i.field !== "shipping");
          }
        } catch (err) {
          if (err instanceof BudgetExhausted) outOfBudget = true;
          else ctx.warn(`${err instanceof Error ? err.message : String(err)}`);
        }
      }

      if (outOfBudget) {
        ctx.warn(
          `Stopped at ${EBAY_CALLS_PER_SCAN} calls for this scan, so some results weren't read. The rest will be picked up on later scans.`,
        );
      }
      return listings;
    },
  };
}

/** True when the listing would match a spec if only its shipping were known (even if it were free). */
function onlyMissingShipping(listing: RawListing, specs: SearchSpec[]): boolean {
  if (listing.shippingCents != null) return false;
  const issues = listing.parseIssues ?? [];
  if (issues.some((i) => i.field !== "shipping")) return false;
  return findMatch({ ...listing, shippingCents: 0, parseIssues: [] }, specs, new Map()).kind === "match";
}

/** So the same few listings don't take every lookup, scan after scan. */
function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export const ebayAdapter = createEbayAdapter();
