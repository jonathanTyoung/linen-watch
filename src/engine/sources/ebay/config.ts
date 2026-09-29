import type { Category, Condition } from "@/lib/catalog";

/**
 * Everything about eBay that might need correcting lives here, so a wrong
 * category id or a changed limit is a one-line fix.
 */

export type EbayEnvironment = "sandbox" | "production";

export const EBAY_HOSTS: Record<EbayEnvironment, string> = {
  production: "https://api.ebay.com",
  sandbox: "https://api.sandbox.ebay.com",
};

/** "View public data from eBay". The only scope search and item lookups need. */
export const EBAY_SCOPE = "https://api.ebay.com/oauth/api_scope";

export const EBAY_MARKETPLACE = "EBAY_US";

/**
 * eBay US category to search in, per kind of item. Null = search by keywords
 * alone.
 *
 * TODO(keys): these came from eBay's May 2022 category list (sheets,
 * pillowcases) and from ebay.com URLs (towels). Confirm all of them through
 * the Taxonomy API once API keys exist:
 *   GET /commerce/taxonomy/v1/category_tree/0/get_category_subtree?category_id=20444
 */
export const EBAY_CATEGORY_IDS: Record<Category, string | null> = {
  flat_sheet: "20460", // Home & Garden > Bedding > Sheets
  fitted_sheet: "20460",
  pillowcase: "54257", // Home & Garden > Bedding > Pillowcases
  bath_towel: "40587", // Towels & Washcloths (name and path unconfirmed)
  hand_towel: null, // not verified
  duvet_cover: null, // not verified
};

/**
 * What an eBay condition means to us. "New other" can be a factory second,
 * so it never counts as new. Null = never matches anything.
 */
export const CONDITION_BY_EBAY_ID: Record<string, Condition | null> = {
  "1000": "new", // New
  "1500": "like_new", // New other (see details)
  "2750": "like_new", // Like New
  "1750": "used", // New with defects
  "2000": "used", // Certified refurbished
  "2010": "used", // Excellent - refurbished
  "2020": "used", // Very good - refurbished
  "2030": "used", // Good - refurbished
  "2500": "used", // Seller refurbished
  "2990": "used", // Pre-owned - excellent (apparel)
  "3000": "used", // Used
  "3010": "used", // Pre-owned - fair (apparel)
  "4000": "used", // Very good
  "5000": "used", // Good
  "6000": "used", // Acceptable
  "7000": null, // For parts or not working
};

/** The eBay condition ids to ask for, given the conditions a spec accepts. */
export function ebayConditionIds(conditions: string[]): string[] {
  return Object.entries(CONDITION_BY_EBAY_ID)
    .filter(([id, ours]) => ours != null && conditions.includes(ours) && id !== "2990" && id !== "3010")
    .map(([id]) => id)
    .sort();
}

/** Listings per search page (eBay's maximum), and how many pages to read per search. */
export const EBAY_PAGE_SIZE = 200;
export const EBAY_MAX_PAGES = 2;

/** Item lookups per scan to find a shipping cost the search didn't give. */
export const EBAY_MAX_SHIPPING_LOOKUPS = 8;

/** Hard ceiling on calls to eBay in one scan, retries included. */
export const EBAY_CALLS_PER_SCAN = 20;

/**
 * eBay's default daily limit for the Browse API, per application.
 * TODO(keys): read the real figure from the Analytics API (getRateLimits).
 */
export const EBAY_DAILY_CALL_LIMIT = 5000;

/** Below this, a day of worst-case scans uses well over half the daily limit. Settings warns. */
export const EBAY_MIN_SCAN_SECONDS = 10 * 60;

/** What to scan at when eBay is on. */
export const EBAY_SUGGESTED_SCAN_SECONDS = 15 * 60;

export const EBAY_TIMEOUT_MS = 8000;
export const EBAY_MAX_ATTEMPTS = 3;
