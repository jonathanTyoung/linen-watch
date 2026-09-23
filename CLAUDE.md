@AGENTS.md

# Linen Watch

Local MVP of an agent that finds white linens under J&N Cleaners' price limits and buys them within guardrails. Sources are mocked; see README.md for the full picture.

## Stack

Next.js 16 (App Router, server actions) · React 19 · Tailwind v4 · SQLite via better-sqlite3 + Drizzle · Vitest · tsx for scripts.

## Rules for this codebase

- **Business logic lives in `src/engine/`**, not in components or actions. `match.ts` and `decide.ts` stay pure and unit-tested. Every purchase path goes through `decide`/`planOrder` + `approvalBlocker`; never write to `orders` from the UI directly.
- **Money is integer cents** everywhere. Format only at render time with `src/lib/money.ts`.
- **Schema changes are migration-only:** edit `src/db/schema.ts`, run `npm run db:generate`, commit the generated SQL in `drizzle/`. Never hand-edit the database.
- **Page reads go through `src/data/loaders.ts`**, and every loader calls `await connection()` first. better-sqlite3 is synchronous, so without it Next would prerender DB reads at build time.
- **UI writes go through `src/app/actions.ts`**, which call engine functions and then `revalidatePath("/", "layout")`.
- **Forms** use `useActionState` but submit via `onSubmit` + `startTransition` so fields aren't reset on validation errors.
- **Never auto-buy from a `checkout_link` source.** Only `api` sources can place orders; everything else hands a person a checkout link.
- Copy is written for Nick and Jake: plain words, say what happened and why.

## Verify before calling anything done

```bash
npm test && npm run lint && npm run build
```

`npm run build` is the real TypeScript gate.
