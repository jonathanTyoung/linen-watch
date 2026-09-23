"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import {
  events,
  listings,
  notifications,
  orders,
  scanRuns,
  settings as settingsTable,
  sources,
  specs,
} from "@/db/schema";
import { seedIfEmpty } from "@/db/seed";
import {
  approveListing,
  confirmCheckout,
  rejectListing,
  type ActionResult,
} from "@/engine/purchasing";
import { logEvent } from "@/engine/queries";
import { runScan } from "@/engine/scan";
import {
  CATEGORIES,
  COLORS,
  CONDITIONS,
  MATERIALS,
  PEOPLE,
  SIZES_BY_CATEGORY,
  actorLabel,
  type Category,
  type Person,
} from "@/lib/catalog";
import { parseDollarsToCents } from "@/lib/money";
import { USER_COOKIE, currentUser } from "@/lib/session";

function refreshAll() {
  revalidatePath("/", "layout");
}

// ---------- who's at the keyboard ----------

export async function switchUser(person: Person): Promise<void> {
  if (!(person in PEOPLE)) return;
  (await cookies()).set(USER_COOKIE, person, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  refreshAll();
}

// ---------- scanning ----------

export async function scanNow(): Promise<ActionResult> {
  const result = await runScan(getDb(), { trigger: "manual" });
  refreshAll();
  if (result.skipped) return { ok: false, message: `${result.reason}. Try again in a moment.` };
  const bits = [`${result.listingsSeen} listings checked`, `${result.matched} matched`];
  if (result.autoBought) bits.push(`${result.autoBought} bought`);
  if (result.queued) bits.push(`${result.queued} need approval`);
  return { ok: true, message: bits.join(" · ") };
}

// ---------- the queue ----------

export async function approve(listingId: number): Promise<ActionResult> {
  const result = await approveListing(getDb(), listingId, await currentUser());
  refreshAll();
  return result;
}

export async function reject(listingId: number): Promise<ActionResult> {
  const result = rejectListing(getDb(), listingId, await currentUser());
  refreshAll();
  return result;
}

export async function markPurchased(listingId: number): Promise<ActionResult> {
  const result = confirmCheckout(getDb(), listingId, await currentUser());
  refreshAll();
  return result;
}

// ---------- specs ----------

export interface FormState {
  message?: string;
  errors?: Record<string, string>;
}

const keys = <T extends Record<string, string>>(m: T) => Object.keys(m) as [keyof T & string, ...(keyof T & string)[]];

const specSchema = z
  .object({
    name: z.string().trim().min(2, "Give the spec a name").max(60),
    category: z.enum(keys(CATEGORIES)),
    size: z.string().transform((v) => v || null),
    color: z.enum(keys(COLORS)),
    materials: z.array(z.enum(keys(MATERIALS))).min(1, "Pick at least one material"),
    minThreadCount: z
      .string()
      .transform((v) => (v.trim() === "" ? null : Number(v)))
      .refine((v) => v === null || (Number.isInteger(v) && v >= 100 && v <= 1500), "Use a thread count between 100 and 1500, or leave it blank"),
    conditions: z.array(z.enum(keys(CONDITIONS))).min(1, "Pick at least one condition"),
    maxUnitPrice: z
      .string()
      .transform((v) => parseDollarsToCents(v))
      .refine((v) => Number.isFinite(v) && v >= 25 && v <= 50000, "Enter a price like 9.50"),
    targetUnits: z.coerce.number().int("Whole units only").min(1, "At least 1").max(100000),
    maxUnitsPerOrder: z.coerce.number().int("Whole units only").min(1, "At least 1").max(10000),
    active: z.boolean(),
  })
  .superRefine((v, ctx) => {
    const allowed = SIZES_BY_CATEGORY[v.category as Category];
    if (allowed.length && (!v.size || !allowed.includes(v.size as never))) {
      ctx.addIssue({ code: "custom", path: ["size"], message: "Pick a size for this item" });
    }
    if (!allowed.length && v.size) {
      ctx.addIssue({ code: "custom", path: ["size"], message: "This item doesn't come in sizes" });
    }
  });

function readSpecForm(fd: FormData) {
  return {
    name: String(fd.get("name") ?? ""),
    category: String(fd.get("category") ?? ""),
    size: String(fd.get("size") ?? ""),
    color: String(fd.get("color") ?? ""),
    materials: fd.getAll("materials").map(String),
    minThreadCount: String(fd.get("minThreadCount") ?? ""),
    conditions: fd.getAll("conditions").map(String),
    maxUnitPrice: String(fd.get("maxUnitPrice") ?? ""),
    targetUnits: String(fd.get("targetUnits") ?? ""),
    maxUnitsPerOrder: String(fd.get("maxUnitsPerOrder") ?? ""),
    active: fd.get("active") === "on",
  };
}

function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}

export async function saveSpec(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = specSchema.safeParse(readSpecForm(fd));
  if (!parsed.success) return { errors: fieldErrors(parsed.error), message: "Fix the highlighted fields." };
  const v = parsed.data;

  const values = {
    name: v.name,
    category: v.category,
    size: v.size,
    color: v.color,
    materials: v.materials,
    minThreadCount: v.minThreadCount,
    conditions: v.conditions,
    maxUnitPriceCents: v.maxUnitPrice,
    targetUnits: v.targetUnits,
    maxUnitsPerOrder: v.maxUnitsPerOrder,
    active: v.active,
  };

  const db = getDb();
  const who = actorLabel(await currentUser());
  const idRaw = fd.get("id");
  if (idRaw) {
    const id = Number(idRaw);
    db.update(specs).set({ ...values, updatedAt: new Date() }).where(eq(specs.id, id)).run();
    logEvent(db, { type: "spec", actor: await currentUser(), message: `${who} updated the ${v.name} spec` });
  } else {
    db.insert(specs).values(values).run();
    logEvent(db, { type: "spec", actor: await currentUser(), message: `${who} added a spec for ${v.name}` });
  }
  refreshAll();
  redirect("/specs");
}

export async function toggleSpec(id: number): Promise<void> {
  const db = getDb();
  const spec = db.select().from(specs).where(eq(specs.id, id)).get();
  if (!spec) return;
  db.update(specs).set({ active: !spec.active, updatedAt: new Date() }).where(eq(specs.id, id)).run();
  const who = actorLabel(await currentUser());
  logEvent(db, {
    type: "spec",
    actor: await currentUser(),
    message: `${who} ${spec.active ? "paused" : "resumed"} the ${spec.name} spec`,
  });
  refreshAll();
}

// ---------- settings ----------

const settingsSchema = z.object({
  autoBuyEnabled: z.boolean(),
  paused: z.boolean(),
  weeklyCap: z
    .string()
    .transform(parseDollarsToCents)
    .refine((v) => Number.isFinite(v) && v >= 0 && v <= 10_000_000, "Enter a dollar amount like 600"),
  perOrderCap: z
    .string()
    .transform(parseDollarsToCents)
    .refine((v) => Number.isFinite(v) && v >= 100 && v <= 10_000_000, "Enter a dollar amount like 300"),
  pendingExpiryMinutes: z.coerce.number().int().min(5, "At least 5 minutes").max(10080, "At most 7 days"),
  scanIntervalSeconds: z.coerce.number().int().min(10, "At least 10 seconds").max(3600, "At most an hour"),
  notifyPhone: z.string().trim().max(30),
});

export async function saveSettings(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = settingsSchema.safeParse({
    autoBuyEnabled: fd.get("autoBuyEnabled") === "on",
    paused: fd.get("paused") === "on",
    weeklyCap: String(fd.get("weeklyCap") ?? ""),
    perOrderCap: String(fd.get("perOrderCap") ?? ""),
    pendingExpiryMinutes: String(fd.get("pendingExpiryMinutes") ?? ""),
    scanIntervalSeconds: String(fd.get("scanIntervalSeconds") ?? ""),
    notifyPhone: String(fd.get("notifyPhone") ?? ""),
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error), message: "Fix the highlighted fields." };
  const v = parsed.data;
  if (v.perOrderCap > v.weeklyCap) {
    return { errors: { perOrderCap: "Can't be more than the weekly cap" }, message: "Fix the highlighted fields." };
  }

  const db = getDb();
  const before = db.select().from(settingsTable).where(eq(settingsTable.id, 1)).get();
  db.update(settingsTable)
    .set({
      autoBuyEnabled: v.autoBuyEnabled,
      paused: v.paused,
      weeklyCapCents: v.weeklyCap,
      perOrderCapCents: v.perOrderCap,
      pendingExpiryMinutes: v.pendingExpiryMinutes,
      scanIntervalSeconds: v.scanIntervalSeconds,
      notifyPhone: v.notifyPhone || null,
    })
    .where(eq(settingsTable.id, 1))
    .run();

  const actor = await currentUser();
  const who = actorLabel(actor);
  const changes: string[] = [];
  if (before?.autoBuyEnabled !== v.autoBuyEnabled) changes.push(`turned auto-buy ${v.autoBuyEnabled ? "on" : "off"}`);
  if (before?.paused !== v.paused) changes.push(v.paused ? "paused all buying" : "resumed buying");
  if (before?.weeklyCapCents !== v.weeklyCap || before?.perOrderCapCents !== v.perOrderCap) changes.push("changed spending caps");
  if (changes.length) logEvent(db, { type: "settings", actor, message: `${who} ${changes.join(", ")}` });

  refreshAll();
  return { message: "Saved." };
}

export async function toggleSource(id: string, field: "enabled" | "autoBuyAllowed"): Promise<ActionResult> {
  const db = getDb();
  const source = db.select().from(sources).where(eq(sources.id, id)).get();
  if (!source) return { ok: false, message: "Unknown source." };
  if (field === "autoBuyAllowed" && source.purchaseMethod !== "api") {
    return { ok: false, message: `${source.name} has no ordering API, so it can't be auto-bought.` };
  }
  const next = !source[field];
  db.update(sources).set({ [field]: next }).where(eq(sources.id, id)).run();
  const actor = await currentUser();
  const what = field === "enabled" ? (next ? "turned on" : "turned off") : next ? "allowed auto-buy for" : "stopped auto-buy for";
  logEvent(db, { type: "settings", actor, message: `${actorLabel(actor)} ${what} ${source.name}` });
  refreshAll();
  return { ok: true, message: "Saved." };
}

/** Wipe everything and start over with the example data. Demo tool only. */
export async function resetDemo(withSampleScans: boolean): Promise<ActionResult> {
  const db = getDb();
  db.transaction((tx) => {
    tx.delete(notifications).run();
    tx.delete(events).run();
    tx.delete(orders).run();
    tx.delete(scanRuns).run();
    tx.delete(listings).run();
    tx.delete(specs).run();
    tx.delete(sources).run();
    tx.delete(settingsTable).run();
  });
  seedIfEmpty(db);
  if (withSampleScans) {
    for (let i = 0; i < 3; i++) await runScan(db, { trigger: "manual" });
  }
  refreshAll();
  return { ok: true, message: withSampleScans ? "Reset, with three sample scans." : "Reset to a clean slate." };
}
