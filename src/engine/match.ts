import { CATEGORIES, CONDITIONS, MATERIALS, SIZES, label, type ListingIssue } from "@/lib/catalog";
import { formatCents, landedUnitCents } from "@/lib/money";
import { stockedNote } from "./decide";

/**
 * The fields matching needs. Both DB rows and raw listings satisfy these.
 * Null means unknown (except `size` and `threadCount`, which can simply not apply).
 */
export interface ListingLike {
  category: string | null;
  size: string | null;
  color: string | null;
  material: string | null;
  threadCount: number | null;
  condition: string | null;
  lotPriceCents: number;
  lotSize: number | null;
  shippingCents: number | null;
  /** What the source couldn't read with confidence, and why. */
  parseIssues?: ListingIssue[] | null;
}

/** A listing with nothing unknown: the only kind that can match or be priced. */
export interface KnownListing {
  category: string;
  color: string;
  material: string;
  condition: string;
  lotSize: number;
  shippingCents: number;
  parseIssues?: [] | null;
}

const IF_MISSING: [keyof ListingLike, ListingIssue][] = [
  ["category", { field: "category", reason: "can't tell what kind of item it is" }],
  ["color", { field: "color", reason: "the color isn't given" }],
  ["material", { field: "material", reason: "the material isn't given" }],
  ["condition", { field: "condition", reason: "the condition isn't given" }],
  ["lotSize", { field: "lotSize", reason: "can't tell how many are in the lot" }],
  ["shippingCents", { field: "shipping", reason: "shipping cost isn't listed" }],
];

/**
 * Everything about `listing` we can't be sure of. Any entry here means the
 * listing must not match: a guess could buy the wrong thing. The source's own
 * reasons come first; a null it didn't explain still counts.
 */
export function unknowns(listing: ListingLike): ListingIssue[] {
  const out = [...(listing.parseIssues ?? [])];
  for (const [key, issue] of IF_MISSING) {
    if (listing[key] == null && !out.some((o) => o.field === issue.field)) out.push(issue);
  }
  return out;
}

export function isKnown<L extends ListingLike>(listing: L): listing is L & KnownListing {
  return unknowns(listing).length === 0;
}

function joinReasons(reasons: string[]): string {
  return reasons.length === 1 ? reasons[0] : `${reasons.slice(0, -1).join(", ")} and ${reasons.at(-1)}`;
}

export interface SpecLike {
  id: number;
  name: string;
  category: string;
  size: string | null;
  color: string;
  materials: string[];
  minThreadCount: number | null;
  conditions: string[];
  maxUnitPriceCents: number;
  targetUnits: number;
  active: boolean;
}

export type MatchResult<S extends SpecLike, L extends ListingLike = ListingLike> =
  | { kind: "match"; spec: S; unitCents: number; listing: L & KnownListing }
  | { kind: "no_match"; reason: string };

/** Every reason `listing` fails `spec`. Empty array = it qualifies. */
export function specFailures(listing: ListingLike & KnownListing, spec: SpecLike): string[] {
  const failures: string[] = [];
  const unit = landedUnitCents(listing.lotPriceCents, listing.lotSize, listing.shippingCents);

  if (listing.color !== spec.color) {
    failures.push(`it's ${listing.color}, not ${spec.color}`);
  }
  if (!spec.materials.includes(listing.material)) {
    failures.push(`${label(MATERIALS, listing.material).toLowerCase()} isn't an accepted material`);
  }
  if (spec.minThreadCount != null) {
    if (listing.threadCount == null) {
      failures.push("thread count isn't listed");
    } else if (listing.threadCount < spec.minThreadCount) {
      failures.push(`${listing.threadCount} TC is under ${spec.minThreadCount}`);
    }
  }
  if (!spec.conditions.includes(listing.condition)) {
    failures.push(`condition is ${label(CONDITIONS, listing.condition).toLowerCase()}`);
  }
  if (unit > spec.maxUnitPriceCents) {
    failures.push(`${formatCents(unit)}/unit is over the ${formatCents(spec.maxUnitPriceCents)} limit`);
  }
  return failures;
}

function sameItem(listing: ListingLike & KnownListing, spec: SpecLike): boolean {
  if (listing.category !== spec.category) return false;
  // A spec with no size accepts any size (towels).
  return spec.size == null || spec.size === listing.size;
}

function describeItem(listing: ListingLike & KnownListing): string {
  const size = listing.size ? `${label(SIZES, listing.size).toLowerCase()} ` : "";
  return `${size}${label(CATEGORIES, listing.category).toLowerCase()}s`;
}

/**
 * Find the spec this listing satisfies. `unitsOwned` is units already bought
 * per spec id, `unitsHeld` is units approved but not bought yet; a spec that
 * has hit its target counting both no longer takes matches.
 * On a miss, explain the closest spec's failures so specs are easy to tune.
 */
export function findMatch<S extends SpecLike, L extends ListingLike>(
  listing: L,
  specs: S[],
  unitsOwned: Map<number, number>,
  unitsHeld: Map<number, number> = new Map(),
): MatchResult<S, L> {
  if (!isKnown(listing)) {
    const reasons = unknowns(listing).map((i) => i.reason);
    return { kind: "no_match", reason: `Can't be sure it fits: ${joinReasons(reasons)}` };
  }

  const candidates = specs.filter((s) => s.active && sameItem(listing, s));
  if (candidates.length === 0) {
    return { kind: "no_match", reason: `No active spec for ${describeItem(listing)}` };
  }

  let closest: { spec: S; failures: string[] } | null = null;
  let fullyStocked: S | null = null;

  for (const spec of candidates) {
    const failures = specFailures(listing, spec);
    if (failures.length === 0) {
      const owned = unitsOwned.get(spec.id) ?? 0;
      if (owned + (unitsHeld.get(spec.id) ?? 0) >= spec.targetUnits) {
        fullyStocked = spec;
        continue;
      }
      return {
        kind: "match",
        spec,
        unitCents: landedUnitCents(listing.lotPriceCents, listing.lotSize, listing.shippingCents),
        listing,
      };
    }
    if (!closest || failures.length < closest.failures.length) {
      closest = { spec, failures };
    }
  }

  if (fullyStocked) {
    const owned = unitsOwned.get(fullyStocked.id) ?? 0;
    const held = unitsHeld.get(fullyStocked.id) ?? 0;
    return {
      kind: "no_match",
      reason: `${fullyStocked.name} is ${stockedNote(fullyStocked.targetUnits, owned, held)}`,
    };
  }

  const c = closest!;
  return { kind: "no_match", reason: `Close to ${c.spec.name}, but ${joinReasons(c.failures)}` };
}
