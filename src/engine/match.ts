import { CATEGORIES, CONDITIONS, MATERIALS, SIZES, label } from "@/lib/catalog";
import { formatCents, landedUnitCents } from "@/lib/money";
import { stockedNote } from "./decide";

/** The fields matching needs. Both DB rows and raw listings satisfy these. */
export interface ListingLike {
  category: string;
  size: string | null;
  color: string;
  material: string;
  threadCount: number | null;
  condition: string;
  lotPriceCents: number;
  lotSize: number;
  shippingCents: number;
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

export type MatchResult<S extends SpecLike> =
  | { kind: "match"; spec: S; unitCents: number }
  | { kind: "no_match"; reason: string };

/** Every reason `listing` fails `spec`. Empty array = it qualifies. */
export function specFailures(listing: ListingLike, spec: SpecLike): string[] {
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

function sameItem(listing: ListingLike, spec: SpecLike): boolean {
  if (listing.category !== spec.category) return false;
  // A spec with no size accepts any size (towels).
  return spec.size == null || spec.size === listing.size;
}

function describeItem(listing: ListingLike): string {
  const size = listing.size ? `${label(SIZES, listing.size).toLowerCase()} ` : "";
  return `${size}${label(CATEGORIES, listing.category).toLowerCase()}s`;
}

/**
 * Find the spec this listing satisfies. `unitsOwned` is units already bought
 * per spec id, `unitsHeld` is units approved but not bought yet; a spec that
 * has hit its target counting both no longer takes matches.
 * On a miss, explain the closest spec's failures so specs are easy to tune.
 */
export function findMatch<S extends SpecLike>(
  listing: ListingLike,
  specs: S[],
  unitsOwned: Map<number, number>,
  unitsHeld: Map<number, number> = new Map(),
): MatchResult<S> {
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
  const joined = c.failures.length === 1 ? c.failures[0] : `${c.failures.slice(0, -1).join(", ")} and ${c.failures.at(-1)}`;
  return { kind: "no_match", reason: `Close to ${c.spec.name}, but ${joined}` };
}
