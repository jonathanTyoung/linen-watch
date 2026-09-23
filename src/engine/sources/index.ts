import { mockAdapters } from "./mock";
import type { SourceAdapter } from "./types";

/**
 * Adapter registry, keyed by source id (matches the `sources` table).
 * To add a real source: implement SourceAdapter, add it here, and insert a
 * matching row in `sources`.
 */
const registry = new Map<string, SourceAdapter>(mockAdapters.map((a) => [a.id, a]));

export function getAdapter(sourceId: string): SourceAdapter | undefined {
  return registry.get(sourceId);
}

export type { SourceAdapter, RawListing, OrderResult } from "./types";
