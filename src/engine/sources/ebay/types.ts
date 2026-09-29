/**
 * The parts of eBay's Browse API responses we read (Browse API v1.20).
 * Everything is optional in eBay's schema, so everything is optional here.
 *
 * Seller fields are left out on purpose: Linen Watch opted out of eBay's
 * account-deletion notifications on the basis that it stores no eBay user
 * data, so seller names and ids must never be read into a listing.
 */

export interface EbayAmount {
  value?: string;
  currency?: string;
  convertedFromValue?: string;
  convertedFromCurrency?: string;
}

export interface EbayShippingOption {
  shippingCostType?: string; // FIXED | CALCULATED
  shippingCost?: EbayAmount;
}

export interface EbayItemSummary {
  itemId?: string;
  legacyItemId?: string;
  title?: string;
  price?: EbayAmount;
  shippingOptions?: EbayShippingOption[];
  condition?: string;
  conditionId?: string;
  itemWebUrl?: string;
  buyingOptions?: string[];
  /** Present when the listing is a group of variations (sizes, colors) under one entry. */
  itemGroupType?: string;
  itemGroupHref?: string;
}

export interface EbaySearchPage {
  total?: number;
  limit?: number;
  offset?: number;
  /** URL of the next page. Absent on the last one. */
  next?: string;
  itemSummaries?: EbayItemSummary[];
  warnings?: { message?: string }[];
}

/** getItem, asked for with fieldgroups=COMPACT. */
export interface EbayItem {
  itemId?: string;
  price?: EbayAmount;
  shippingOptions?: EbayShippingOption[];
}
