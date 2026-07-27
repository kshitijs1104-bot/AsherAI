import { db, businessProfilesTable, settingsTable, companyFactsTable, type BusinessProfile } from "@workspace/db";
import { eq, and, ne, isNull } from "drizzle-orm";
import { tokenize } from "./retrieval";

// Service layer for the durable, switchable business profile (see
// lib/db/src/schema/business_profiles.ts for the full rationale). Every
// function here is best-effort — a failure must never break the chat
// response it's attached to, same philosophy as retrieval.ts/companyMemory.ts.

// Turns a founder's own description into a short label used only to tell
// them what Vera is doing ("switching back to X"), never asked for up
// front. Founders front-load the actual business description before
// stage/metrics detail ("DTC coffee subscription brand, seed stage, about
// 18 months old...") so cutting at the first clause break keeps the label
// meaningful without the trailing numbers.
export function deriveProfileName(description: string): string {
  const trimmed = description.trim();
  if (!trimmed) return "your business";
  const firstClause = trimmed.split(/[,.;]| — |\bwho\b/i)[0]?.trim() ?? "";
  const base = firstClause.length >= 8 ? firstClause : trimmed;
  return base.length > 60 ? `${base.slice(0, 60).trim()}…` : base;
}

export async function getActiveProfile(userId: string): Promise<BusinessProfile | null> {
  try {
    const [settingsRow] = await db.select().from(settingsTable).where(eq(settingsTable.sessionId, userId)).limit(1);
    if (!settingsRow?.activeProfileId) return null;
    const [profile] = await db
      .select()
      .from(businessProfilesTable)
      .where(eq(businessProfilesTable.id, settingsRow.activeProfileId))
      .limit(1);
    return profile ?? null;
  } catch (err) {
    console.error("[businessProfiles] failed to load active profile", err);
    return null;
  }
}

// Auto-provisions a founder's first profile from their legacy single-blob
// state the first time this runs for them, so shipping this table doesn't
// reset anyone to zero. Also adopts any pre-existing, unscoped business_fact
// rows onto the new profile so nothing already captured is orphaned.
// Idempotent: once a founder has an activeProfileId, this just returns it.
export async function getOrCreateActiveProfile(userId: string): Promise<BusinessProfile | null> {
  try {
    const existing = await getActiveProfile(userId);
    if (existing) return existing;

    const [settingsRow] = await db.select().from(settingsTable).where(eq(settingsTable.sessionId, userId)).limit(1);
    const legacyBlob = settingsRow?.venusBusinessContext?.trim() || "";

    const [profile] = await db
      .insert(businessProfilesTable)
      .values({
        userId,
        name: legacyBlob ? deriveProfileName(legacyBlob) : "your business",
        contextBlob: legacyBlob || null,
        contextUpdatedAt: legacyBlob ? new Date() : null,
      })
      .returning();
    if (!profile) return null;

    // Adopt pre-existing unscoped business facts (predate this column) onto
    // the newly-provisioned profile rather than leaving them orphaned.
    await db
      .update(companyFactsTable)
      .set({ profileId: profile.id })
      .where(and(
        eq(companyFactsTable.userId, userId),
        eq(companyFactsTable.entryKind, "business_fact"),
        isNull(companyFactsTable.profileId),
      ));

    if (settingsRow) {
      await db.update(settingsTable).set({ activeProfileId: profile.id, updatedAt: new Date() }).where(eq(settingsTable.sessionId, userId));
    } else {
      await db.insert(settingsTable).values({ sessionId: userId, activeProfileId: profile.id }).onConflictDoNothing({ target: settingsTable.sessionId });
    }

    return profile;
  } catch (err) {
    console.error("[businessProfiles] failed to get/create active profile", err);
    return null;
  }
}

// Minimum shared substantive tokens (post-stopword, via retrieval.ts's
// tokenize) before two descriptions count as "the same business" — deliberately
// small and permissive compared to retrieval.ts's precedent-matching
// thresholds, because this only ever compares against a handful of a single
// founder's OWN profiles (at most a few), not a large third-party corpus —
// the false-positive risk that motivates the strict gates over there doesn't
// apply here at anywhere near the same scale.
const MIN_PROFILE_MATCH_OVERLAP = 2;
const MIN_PROFILE_MATCH_RATIO = 0.2;

// Finds an existing OTHER profile (not the currently-active one, if any)
// whose stored name/context resembles the new description, so switching
// back to a business the founder already told Vera about restores it
// instead of starting over. Returns the single best match, or null if
// nothing clears the floor above.
export async function findMatchingProfile(
  userId: string,
  description: string,
  excludeProfileId?: number,
): Promise<BusinessProfile | null> {
  try {
    const conditions = [eq(businessProfilesTable.userId, userId)];
    if (excludeProfileId) conditions.push(ne(businessProfilesTable.id, excludeProfileId));
    const others = await db.select().from(businessProfilesTable).where(and(...conditions));
    if (others.length === 0) return null;

    const descTokens = new Set(tokenize(description));
    if (descTokens.size === 0) return null;

    let best: { profile: BusinessProfile; overlap: number } | null = null;
    for (const profile of others) {
      const profileTokens = new Set(tokenize([profile.name, profile.contextBlob ?? ""].join(" ")));
      if (profileTokens.size === 0) continue;

      let overlap = 0;
      for (const t of descTokens) if (profileTokens.has(t)) overlap++;
      const ratio = overlap / Math.min(descTokens.size, profileTokens.size);

      if (overlap >= MIN_PROFILE_MATCH_OVERLAP && ratio >= MIN_PROFILE_MATCH_RATIO) {
        if (!best || overlap > best.overlap) best = { profile, overlap };
      }
    }
    return best?.profile ?? null;
  } catch (err) {
    console.error("[businessProfiles] failed to find matching profile", err);
    return null;
  }
}

export async function createProfile(userId: string, description: string): Promise<BusinessProfile | null> {
  try {
    const [profile] = await db
      .insert(businessProfilesTable)
      .values({
        userId,
        name: deriveProfileName(description),
        contextBlob: description,
        contextUpdatedAt: new Date(),
      })
      .returning();
    return profile ?? null;
  } catch (err) {
    console.error("[businessProfiles] failed to create profile", err);
    return null;
  }
}

export async function setActiveProfile(userId: string, profileId: number): Promise<void> {
  try {
    await db.update(businessProfilesTable).set({ lastActiveAt: new Date() }).where(eq(businessProfilesTable.id, profileId));
    const [existing] = await db.select().from(settingsTable).where(eq(settingsTable.sessionId, userId)).limit(1);
    if (existing) {
      await db.update(settingsTable).set({ activeProfileId: profileId, updatedAt: new Date() }).where(eq(settingsTable.sessionId, userId));
    } else {
      await db.insert(settingsTable).values({ sessionId: userId, activeProfileId: profileId }).onConflictDoNothing({ target: settingsTable.sessionId });
    }
  } catch (err) {
    console.error("[businessProfiles] failed to set active profile", err);
  }
}

export async function updateProfileContext(profileId: number, contextBlob: string): Promise<void> {
  try {
    await db
      .update(businessProfilesTable)
      .set({ contextBlob, contextUpdatedAt: new Date(), updatedAt: new Date() })
      .where(eq(businessProfilesTable.id, profileId));
  } catch (err) {
    console.error("[businessProfiles] failed to update profile context", err);
  }
}

// Every profile a founder has, most recently active first — for a future
// "switch business" picker; unused by the chat flow itself today.
export async function listProfiles(userId: string): Promise<BusinessProfile[]> {
  try {
    return await db.select().from(businessProfilesTable).where(eq(businessProfilesTable.userId, userId));
  } catch (err) {
    console.error("[businessProfiles] failed to list profiles", err);
    return [];
  }
}
