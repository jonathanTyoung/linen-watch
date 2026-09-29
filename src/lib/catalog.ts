/**
 * The vocabulary Linen Watch understands. Everything that describes a linen
 * (on a spec or a listing) uses these values. Placeholder set until Nick
 * confirms what J&N actually stocks.
 */

export const CATEGORIES = {
  flat_sheet: "Flat sheet",
  fitted_sheet: "Fitted sheet",
  pillowcase: "Pillowcase",
  duvet_cover: "Duvet cover",
  bath_towel: "Bath towel",
  hand_towel: "Hand towel",
} as const;
export type Category = keyof typeof CATEGORIES;

export const SIZES = {
  twin: "Twin",
  full: "Full",
  queen: "Queen",
  king: "King",
  standard: "Standard",
  king_pillow: "King pillow",
} as const;
export type Size = keyof typeof SIZES;

/** Which sizes make sense for which category. Towels have no size. */
export const SIZES_BY_CATEGORY: Record<Category, Size[]> = {
  flat_sheet: ["twin", "full", "queen", "king"],
  fitted_sheet: ["twin", "full", "queen", "king"],
  duvet_cover: ["twin", "full", "queen", "king"],
  pillowcase: ["standard", "king_pillow"],
  bath_towel: [],
  hand_towel: [],
};

export const MATERIALS = {
  percale: "Cotton percale",
  sateen: "Cotton sateen",
  cotton_terry: "Cotton terry",
  poly_cotton: "Poly-cotton blend",
  microfiber: "Microfiber",
} as const;
export type Material = keyof typeof MATERIALS;

export const CONDITIONS = {
  new: "New",
  like_new: "Like new",
  used: "Used",
} as const;
export type Condition = keyof typeof CONDITIONS;

export const COLORS = {
  white: "White",
  ivory: "Ivory",
  gray: "Gray",
} as const;
export type Color = keyof typeof COLORS;

/**
 * Something about a listing we couldn't read with confidence, and why, in
 * plain words. `field` is what it leaves unknown; "listing" is for problems
 * with the listing as a whole.
 */
export interface ListingIssue {
  field: "category" | "size" | "color" | "material" | "condition" | "lotSize" | "shipping" | "listing";
  reason: string;
}

/**
 * Something a person should see before approving a listing. Unlike an issue,
 * it doesn't stop the listing from matching.
 */
export interface ListingCaution {
  label: string;
  detail: string;
}

export const LISTING_STATUSES = {
  pending: "Needs approval",
  ordering: "Ordering",
  awaiting_checkout: "Awaiting checkout",
  purchased: "Purchased",
  rejected: "Rejected",
  blocked: "Blocked",
  expired: "Expired",
  unmatched: "Not a match",
} as const;
export type ListingStatus = keyof typeof LISTING_STATUSES;

export const PEOPLE = {
  nick: "Nick",
  jake: "Jake",
} as const;
export type Person = keyof typeof PEOPLE;
export type Actor = Person | "agent" | "system";

export function actorLabel(actor: string): string {
  if (actor === "agent") return "Agent";
  if (actor === "system") return "System";
  return PEOPLE[actor as Person] ?? actor;
}

export function label<T extends Record<string, string>>(
  map: T,
  key: string | null | undefined,
): string {
  if (!key) return "Any";
  return (map as Record<string, string>)[key] ?? key;
}
