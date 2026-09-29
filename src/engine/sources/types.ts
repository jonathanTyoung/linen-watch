import type { Category, Color, Condition, ListingIssue, Material, Size } from "@/lib/catalog";

/**
 * A listing as a source reports it, before we store or judge it.
 *
 * Real sources describe items in free text, so anything we can't read with
 * confidence is null rather than a guess. A listing with an unknown never
 * matches a spec; it's stored under "Not a match" with `issues` as the reason.
 */
export interface RawListing {
  externalId: string;
  title: string;
  url: string;
  category: Category | null;
  /** Null also means "comes in no sizes" (towels). An unreadable size is listed in `issues`. */
  size: Size | null;
  color: Color | null;
  material: Material | null;
  threadCount: number | null;
  condition: Condition | null;
  lotPriceCents: number;
  /** Null = a multi-pack whose count we couldn't read. */
  lotSize: number | null;
  lotsAvailable: number;
  /** Flat shipping for the order. Null = not listed, which is never treated as free. */
  shippingCents: number | null;
  /** What couldn't be read with confidence, and why. */
  parseIssues?: ListingIssue[] | null;
}

export interface OrderContext {
  now: Date;
  rng: () => number;
}

/** What a source may search for. The subset of a spec that shapes a search. */
export interface SearchSpec {
  id: number;
  name: string;
  category: string;
  size: string | null;
  color: string;
  materials: string[];
  minThreadCount: number | null;
  conditions: string[];
  maxUnitPriceCents: number;
  maxUnitsPerOrder: number;
  targetUnits: number;
  active: boolean;
}

export interface FetchContext extends OrderContext {
  /** Active specs. Real sources run one search per spec; mock sources ignore them. */
  specs: SearchSpec[];
  /** Where orders ship, for shipping quotes. */
  shipToZip: string;
  /** No single order can cost more than this, so there's no point fetching pricier lots. */
  perOrderCapCents: number;
  /** Report a problem that didn't stop the fetch (one search failed, call budget ran out). */
  warn: (message: string) => void;
}

export interface OrderRequest {
  externalId: string;
  lots: number;
  expectedLotPriceCents: number;
}

export type OrderResult =
  | { ok: true; externalRef: string }
  | { ok: false; error: string };

/**
 * One implementation per place we look for linens. Mock adapters live in
 * ./mock.ts. A real one (e.g. eBay Browse + Buy APIs) implements the same
 * interface and gets registered in ./index.ts; nothing else changes.
 */
export interface SourceAdapter {
  id: string;
  fetchListings(ctx: FetchContext): Promise<RawListing[]>;
  /**
   * Only for sources whose purchase method is "api". Sources without it are
   * never auto-bought; approving one hands the person a checkout link.
   */
  placeOrder?(req: OrderRequest, ctx: OrderContext): Promise<OrderResult>;
}
