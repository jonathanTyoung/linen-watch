/**
 * Which sources a scan is allowed to use, decided by the environment:
 *
 *   LINEN_SOURCES=mock   the simulated sources only (default; demos)
 *   LINEN_SOURCES=ebay   eBay only
 *   LINEN_SOURCES=all    both
 *
 * A source also has to be switched on in Settings. eBay additionally needs
 * its API keys; without them it stays off and Settings says why.
 */

export type SourceSelection = "mock" | "ebay" | "all";

export const EBAY_SOURCE_ID = "ebay";

type Env = Record<string, string | undefined>;

export function sourceSelection(env: Env = process.env): SourceSelection {
  const raw = (env.LINEN_SOURCES ?? "").trim().toLowerCase();
  return raw === "ebay" || raw === "all" ? raw : "mock";
}

export function hasEbayKeys(env: Env = process.env): boolean {
  return !!env.EBAY_CLIENT_ID?.trim() && !!env.EBAY_CLIENT_SECRET?.trim();
}

export type SourceStatus = { active: true } | { active: false; reason: string };

/** Whether scans will use this source, and if not, what to do about it. */
export function sourceStatus(sourceId: string, env: Env = process.env): SourceStatus {
  const selection = sourceSelection(env);

  if (sourceId === EBAY_SOURCE_ID) {
    if (selection === "mock") {
      return {
        active: false,
        reason: "Not scanning eBay: LINEN_SOURCES is set to mock. Set LINEN_SOURCES=ebay (or all) and restart to turn it on.",
      };
    }
    if (!hasEbayKeys(env)) {
      return {
        active: false,
        reason:
          "Not scanning eBay: the API keys are missing. Add EBAY_CLIENT_ID and EBAY_CLIENT_SECRET to .env.local and restart.",
      };
    }
    return { active: true };
  }

  if (selection === "ebay") {
    return {
      active: false,
      reason: "Not scanning: LINEN_SOURCES is set to ebay, so the simulated sources are off.",
    };
  }
  return { active: true };
}

/** True when scans will actually call eBay, which has a daily call limit. */
export function ebayActive(env: Env = process.env): boolean {
  return sourceStatus(EBAY_SOURCE_ID, env).active;
}
