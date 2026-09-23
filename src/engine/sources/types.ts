import type { Category, Color, Condition, Material, Size } from "@/lib/catalog";

/** A listing as a source reports it, before we store or judge it. */
export interface RawListing {
  externalId: string;
  title: string;
  url: string;
  category: Category;
  size: Size | null;
  color: Color;
  material: Material;
  threadCount: number | null;
  condition: Condition;
  lotPriceCents: number;
  lotSize: number;
  lotsAvailable: number;
  /** Flat shipping for the order. */
  shippingCents: number;
}

export interface FetchContext {
  now: Date;
  rng: () => number;
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
  placeOrder?(req: OrderRequest, ctx: FetchContext): Promise<OrderResult>;
}
