import { reason, type EbayCredentials, type TokenProvider } from "./auth";
import { EBAY_HOSTS, EBAY_MARKETPLACE, EBAY_MAX_ATTEMPTS, EBAY_TIMEOUT_MS } from "./config";
import type { EbayItem, EbaySearchPage } from "./types";

/**
 * Thin client for the two Browse API calls we make: search and item lookup.
 * Plain fetch with a timeout, retries with backoff when eBay is busy (429) or
 * failing (5xx), and a call budget so one scan can never burn through the
 * daily limit.
 */

/** Counts every request sent to eBay, retries included. */
export class CallBudget {
  used = 0;
  constructor(readonly limit: number) {}

  get remaining(): number {
    return Math.max(0, this.limit - this.used);
  }

  /** Spend one call. False if there are none left. */
  take(): boolean {
    if (this.used >= this.limit) return false;
    this.used++;
    return true;
  }
}

export class BudgetExhausted extends Error {
  constructor(limit: number) {
    super(`stopped at the limit of ${limit} eBay calls for one scan`);
    this.name = "BudgetExhausted";
  }
}

export class EbayApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "EbayApiError";
  }
}

export interface SearchParams {
  q: string;
  categoryId: string | null;
  /** Already in eBay's filter syntax, unencoded. */
  filter: string;
  sort: string;
  limit: number;
  offset: number;
}

export interface EbayClientDeps {
  creds: EbayCredentials;
  tokens: TokenProvider;
  budget: CallBudget;
  /** Where orders ship. eBay needs it to quote calculated shipping. */
  shipToZip: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  rng?: () => number;
  timeoutMs?: number;
  maxAttempts?: number;
}

export interface EbayClient {
  search(params: SearchParams): Promise<EbaySearchPage>;
  getItem(itemId: string): Promise<EbayItem>;
}

/** eBay wants `contextualLocation=country=US,zip=37203` with the value URL-encoded. */
export function endUserContext(zip: string): string {
  return `contextualLocation=${encodeURIComponent(`country=US,zip=${zip}`)}`;
}

export function searchUrl(host: string, p: SearchParams): string {
  const query: [string, string][] = [["q", p.q]];
  if (p.categoryId) query.push(["category_ids", p.categoryId]);
  query.push(["filter", p.filter], ["sort", p.sort], ["limit", String(p.limit)], ["offset", String(p.offset)]);
  const qs = query.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  return `${host}/buy/browse/v1/item_summary/search?${qs}`;
}

const MAX_BACKOFF_MS = 8000;

export function createEbayClient(deps: EbayClientDeps): EbayClient {
  const doFetch: typeof fetch = (...args) => (deps.fetch ?? globalThis.fetch)(...args);
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const rng = deps.rng ?? Math.random;
  const timeoutMs = deps.timeoutMs ?? EBAY_TIMEOUT_MS;
  const maxAttempts = deps.maxAttempts ?? EBAY_MAX_ATTEMPTS;
  const host = EBAY_HOSTS[deps.creds.environment];

  async function get<T>(url: string, what: string): Promise<T> {
    let lastError: Error = new Error(`${what} failed`);
    let refreshedToken = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const token = await deps.tokens.getToken();
      if (!deps.budget.take()) throw new BudgetExhausted(deps.budget.limit);

      let res: Response;
      try {
        res = await doFetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            "X-EBAY-C-MARKETPLACE-ID": EBAY_MARKETPLACE,
            "X-EBAY-C-ENDUSERCTX": endUserContext(deps.shipToZip),
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        // Timeouts and dropped connections are worth another try.
        lastError = new Error(`${what}: couldn't reach eBay (${reason(err)})`);
        if (attempt < maxAttempts) await sleep(backoff(attempt, null, rng));
        continue;
      }

      if (res.ok) return (await res.json()) as T;

      const message = await errorMessage(res);
      lastError = new EbayApiError(res.status, `${what}: eBay said HTTP ${res.status} (${message})`);

      // A rejected token gets one fresh sign-in, then it's a real failure.
      if (res.status === 401 && !refreshedToken) {
        refreshedToken = true;
        deps.tokens.invalidate();
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        if (attempt < maxAttempts) await sleep(backoff(attempt, res.headers.get("retry-after"), rng));
        continue;
      }
      throw lastError;
    }
    throw lastError;
  }

  return {
    search: (params) => get<EbaySearchPage>(searchUrl(host, params), `Search "${params.q}"`),
    getItem: (itemId) =>
      get<EbayItem>(
        `${host}/buy/browse/v1/item/${encodeURIComponent(itemId)}?fieldgroups=COMPACT`,
        `Item lookup ${itemId}`,
      ),
  };
}

/** 0.5s, 1s, 2s… with jitter, or what eBay asks for in Retry-After, never more than 8s. */
function backoff(attempt: number, retryAfter: string | null, rng: () => number): number {
  const asked = retryAfter ? Number(retryAfter) * 1000 : NaN;
  if (Number.isFinite(asked) && asked > 0) return Math.min(asked, MAX_BACKOFF_MS);
  const base = 500 * 2 ** (attempt - 1);
  return Math.min(base + rng() * base * 0.5, MAX_BACKOFF_MS);
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { errors?: { message?: string; longMessage?: string }[] };
    const first = body.errors?.[0];
    return first?.longMessage ?? first?.message ?? "no details";
  } catch {
    return "no details";
  }
}
