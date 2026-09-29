import { describe, expect, it } from "vitest";
import { fakeEbay, json, TEST_KEYS } from "./__fixtures__/fake-ebay";
import tokenError from "./__fixtures__/token-error.json";
import { createTokenProvider, readCredentials } from "./auth";

const creds = readCredentials(TEST_KEYS)!;

describe("readCredentials", () => {
  it("needs both keys", () => {
    expect(readCredentials({})).toBeNull();
    expect(readCredentials({ EBAY_CLIENT_ID: "x" })).toBeNull();
    expect(readCredentials({ EBAY_CLIENT_ID: "x", EBAY_CLIENT_SECRET: "  " })).toBeNull();
  });

  it("uses the sandbox unless production is asked for by name", () => {
    expect(readCredentials({ EBAY_CLIENT_ID: "x", EBAY_CLIENT_SECRET: "y" })?.environment).toBe("sandbox");
    expect(readCredentials({ EBAY_CLIENT_ID: "x", EBAY_CLIENT_SECRET: "y", EBAY_ENV: "prod" })?.environment).toBe("sandbox");
    expect(readCredentials({ EBAY_CLIENT_ID: "x", EBAY_CLIENT_SECRET: "y", EBAY_ENV: "Production" })?.environment).toBe(
      "production",
    );
  });
});

describe("token provider", () => {
  it("asks eBay the way its docs say to", async () => {
    const ebay = fakeEbay();
    const token = await createTokenProvider(creds, { fetch: ebay.fetch }).getToken();
    expect(token).toBe("v^1.1#i^1#fixture-token-not-real");

    const [call] = ebay.signIns();
    expect(call.method).toBe("POST");
    expect(call.url.href).toBe("https://api.sandbox.ebay.com/identity/v1/oauth2/token");
    expect(call.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    const basic = Buffer.from(`${TEST_KEYS.EBAY_CLIENT_ID}:${TEST_KEYS.EBAY_CLIENT_SECRET}`).toString("base64");
    expect(call.headers.authorization).toBe(`Basic ${basic}`);
    expect(call.body).toBe("grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope");
  });

  it("signs in to production when told to", async () => {
    const ebay = fakeEbay();
    const prod = readCredentials({ ...TEST_KEYS, EBAY_ENV: "production" })!;
    await createTokenProvider(prod, { fetch: ebay.fetch }).getToken();
    expect(ebay.signIns()[0].url.host).toBe("api.ebay.com");
  });

  it("reuses the token until shortly before it expires", async () => {
    const ebay = fakeEbay();
    let now = 1_000_000;
    const tokens = createTokenProvider(creds, { fetch: ebay.fetch, now: () => now });

    await tokens.getToken();
    now += 110 * 60 * 1000; // 1h50m into a 2h token
    await tokens.getToken();
    expect(ebay.signIns()).toHaveLength(1);

    now += 6 * 60 * 1000; // inside the last five minutes
    await tokens.getToken();
    expect(ebay.signIns()).toHaveLength(2);
  });

  it("shares one sign-in between requests made at the same time", async () => {
    const ebay = fakeEbay();
    const tokens = createTokenProvider(creds, { fetch: ebay.fetch });
    await Promise.all([tokens.getToken(), tokens.getToken(), tokens.getToken()]);
    expect(ebay.signIns()).toHaveLength(1);
  });

  it("signs in again after the token is thrown away", async () => {
    const ebay = fakeEbay();
    const tokens = createTokenProvider(creds, { fetch: ebay.fetch });
    await tokens.getToken();
    tokens.invalidate();
    await tokens.getToken();
    expect(ebay.signIns()).toHaveLength(2);
  });

  it("explains a rejected sign-in without leaking the secret", async () => {
    const ebay = fakeEbay(() => json(tokenError, 401));
    const attempt = createTokenProvider(creds, { fetch: ebay.fetch }).getToken();
    await expect(attempt).rejects.toThrow(/eBay sign-in failed \(HTTP 401: client authentication failed\)/);
    const message = await attempt.catch((e: Error) => e.message);
    expect(message).not.toContain(TEST_KEYS.EBAY_CLIENT_SECRET);
    expect(message).not.toContain(Buffer.from(`${TEST_KEYS.EBAY_CLIENT_ID}:${TEST_KEYS.EBAY_CLIENT_SECRET}`).toString("base64"));
  });

  it("doesn't cache a failure", async () => {
    let fail = true;
    const ebay = fakeEbay(() => (fail ? json(tokenError, 401) : undefined));
    const tokens = createTokenProvider(creds, { fetch: ebay.fetch });
    await expect(tokens.getToken()).rejects.toThrow();
    fail = false;
    await expect(tokens.getToken()).resolves.toMatch(/fixture-token/);
  });
});
