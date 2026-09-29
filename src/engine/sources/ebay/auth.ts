import { EBAY_HOSTS, EBAY_SCOPE, EBAY_TIMEOUT_MS, type EbayEnvironment } from "./config";

/**
 * eBay application token (OAuth client-credentials grant). Tokens last two
 * hours and eBay allows 1,000 requests for one a day, so each is kept in
 * memory and reused until shortly before it expires.
 *
 * The client secret and the token are never logged or put in error messages.
 */

export interface EbayCredentials {
  clientId: string;
  clientSecret: string;
  environment: EbayEnvironment;
}

type Env = Record<string, string | undefined>;

/** Keys from the environment, or null if they aren't set. */
export function readCredentials(env: Env = process.env): EbayCredentials | null {
  const clientId = env.EBAY_CLIENT_ID?.trim();
  const clientSecret = env.EBAY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const environment = env.EBAY_ENV?.trim().toLowerCase() === "production" ? "production" : "sandbox";
  return { clientId, clientSecret, environment };
}

export interface TokenProvider {
  getToken(): Promise<string>;
  /** Forget the cached token, e.g. after eBay rejects it. */
  invalidate(): void;
}

export interface TokenDeps {
  fetch?: typeof fetch;
  now?: () => number;
}

/** Ask for a new token this long before the old one runs out. */
const REFRESH_EARLY_MS = 5 * 60 * 1000;

export function createTokenProvider(creds: EbayCredentials, deps: TokenDeps = {}): TokenProvider {
  const doFetch: typeof fetch = (...args) => (deps.fetch ?? globalThis.fetch)(...args);
  const now = deps.now ?? Date.now;
  let cached: { token: string; refreshAt: number } | null = null;
  let inFlight: Promise<string> | null = null;

  async function request(): Promise<string> {
    const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64");
    let res: Response;
    try {
      res = await doFetch(`${EBAY_HOSTS[creds.environment]}/identity/v1/oauth2/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${basic}`,
        },
        body: new URLSearchParams({ grant_type: "client_credentials", scope: EBAY_SCOPE }).toString(),
        signal: AbortSignal.timeout(EBAY_TIMEOUT_MS),
      });
    } catch (err) {
      throw new Error(`Couldn't reach eBay to sign in (${reason(err)})`);
    }

    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      // eBay's error names ("invalid_client") are safe to show; they never echo the secret.
      const why = field(body, "error_description") ?? field(body, "error") ?? "no reason given";
      throw new Error(
        `eBay sign-in failed (HTTP ${res.status}: ${why}). Check EBAY_CLIENT_ID, EBAY_CLIENT_SECRET and EBAY_ENV (${creds.environment}).`,
      );
    }

    const token = field(body, "access_token");
    const expiresIn = Number((body as Record<string, unknown> | null)?.expires_in);
    if (!token || !Number.isFinite(expiresIn)) {
      throw new Error("eBay sign-in returned no token");
    }
    cached = { token, refreshAt: now() + expiresIn * 1000 - REFRESH_EARLY_MS };
    return token;
  }

  return {
    async getToken() {
      if (cached && now() < cached.refreshAt) return cached.token;
      // Searches run back to back; they share one sign-in.
      inFlight ??= request().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
    invalidate() {
      cached = null;
    },
  };
}

const providers = new Map<string, TokenProvider>();

/** One shared provider per set of keys, so every scan in this process reuses the token. */
export function tokenProviderFor(creds: EbayCredentials): TokenProvider {
  const key = `${creds.environment}:${creds.clientId}`;
  let provider = providers.get(key);
  if (!provider) {
    provider = createTokenProvider(creds);
    providers.set(key, provider);
  }
  return provider;
}

function field(body: unknown, key: string): string | null {
  if (body && typeof body === "object" && key in body) {
    const value = (body as Record<string, unknown>)[key];
    if (typeof value === "string" && value) return value;
  }
  return null;
}

export function reason(err: unknown): string {
  if (err instanceof Error) {
    return err.name === "TimeoutError" || err.name === "AbortError" ? "timed out" : err.message;
  }
  return String(err);
}
