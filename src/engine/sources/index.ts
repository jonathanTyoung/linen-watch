import { ebayAdapter } from "./ebay/adapter";
import { mockAdapters } from "./mock";
import type { SourceAdapter } from "./types";

/**
 * Adapter registry, keyed by source id (matches the `sources` table).
 * To add a real source: implement SourceAdapter, add it here, and add a
 * matching row to SEED_SOURCES in src/db/seed.ts.
 *
 * Which of these a scan actually uses is decided in ./selection.ts
 * (LINEN_SOURCES) and by the Scan switch in Settings.
 */
const registry = new Map<string, SourceAdapter>([...mockAdapters, ebayAdapter].map((a) => [a.id, a]));

export function getAdapter(sourceId: string): SourceAdapter | undefined {
  return registry.get(sourceId);
}

export type { SourceAdapter, RawListing, OrderResult } from "./types";
