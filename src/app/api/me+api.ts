import { eq, inArray, sql } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';
import { accessibleStoreIds } from '@/lib/tenant';
import { TERMS_VERSION } from '@/lib/legal';

// GET /api/me — verify the Supabase access token, ensure a creators row exists, and
// return the profile (+ their stores). The app calls this right after sign-in.
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  try {
    // Create the creator on first sign-in, capturing the profile + legal acceptance the email-
    // signup form put in user_metadata (providers usually give name only). On an existing row we
    // backfill missing name/phone and record the accepted terms version + timestamp once — we never
    // overwrite an already-recorded acceptance or email.
    await db
      .insert(schema.creators)
      .values({
        id: user.id,
        email: user.email,
        name: user.name ?? null,
        phone: user.phone ?? null,
        // Email signup carries terms_version in the token; OAuth (Apple/Google) does NOT — record the
        // current TERMS_VERSION as a backstop so the affirmative acceptance shown on the auth screen is
        // captured for those creators too. The coalesce() below never overwrites an already-recorded one.
        termsVersion: user.termsVersion ?? TERMS_VERSION,
        termsAcceptedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.creators.id,
        set: {
          name: sql`coalesce(${schema.creators.name}, excluded.name)`,
          phone: sql`coalesce(${schema.creators.phone}, excluded.phone)`,
          termsVersion: sql`coalesce(${schema.creators.termsVersion}, excluded.terms_version)`,
          termsAcceptedAt: sql`coalesce(${schema.creators.termsAcceptedAt}, excluded.terms_accepted_at)`,
        },
      });
    const stores = await db
      .select({
        id: schema.stores.id,
        name: schema.stores.name,
        slug: schema.stores.slug,
        status: schema.stores.status,
        logoUrl: schema.stores.logoUrl,
        ogImageUrl: schema.stores.ogImageUrl,
        tagline: schema.stores.tagline,
        siteAssets: schema.stores.siteAssets,
        // Eve's developing state (edit-site) needs the real storefront URL — it is never derived
        // from the slug (github.com deploymentUrl = placeholder, no site yet). Client applies the
        // same rule as /api/store/[slug]: customDomain ? https://custom : non-github deploymentUrl.
        deploymentUrl: schema.stores.deploymentUrl,
        customDomain: schema.stores.customDomain,
      })
      .from(schema.stores)
      .where(inArray(schema.stores.id, await accessibleStoreIds(user.id)));
    // A brand's banner is GENERATED, never hand-uploaded: stores created before the OG card
    // existed (or renamed since — buildBrandPatch nulls og_image_url) fall back to the same
    // deterministic Cloudinary transform at read time. Pure URL construction — no fetch, no
    // write; Cloudinary renders + CDN-caches on first view. Brands with no logo return null
    // and the client keeps its tile fallback.
    const { buildOgImageUrl } = await import('@/lib/og-image');
    for (const s of stores) {
      if (!s.ogImageUrl && s.logoUrl) {
        s.ogImageUrl = buildOgImageUrl({ logoUrl: s.logoUrl, tagline: s.tagline });
      }
    }
    // Read back the stored (backfilled) name so Eve can greet returning creators by name even when
    // the auth token metadata lacks it (e.g. Apple sign-in after the first login).
    const [profile] = await db
      .select({ name: schema.creators.name })
      .from(schema.creators)
      .where(eq(schema.creators.id, user.id))
      .limit(1);
    return Response.json({ creator: { id: user.id, email: user.email, name: profile?.name ?? user.name ?? null }, stores });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}

// DELETE /api/me — permanently delete the creator's account and all their data. Required by
// the App Store (and the Meta data-deletion policy) for any app with account creation.
// Deleting the creators row cascades to stores → catalogues/designs/products/orders/
// subscriptions/credits/device tokens. Likes (keyed by the raw auth id) are removed too,
// and we best-effort delete the Supabase auth identity when a service role key is present.
export async function DELETE(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  try {
    await db.delete(schema.productLikes).where(eq(schema.productLikes.userId, user.id)).catch(() => {});
    await db.delete(schema.creators).where(eq(schema.creators.id, user.id));

    const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
    // SUPABASE_SECRET_KEY is the deployed name (new-style sb_secret key); the old service-role
    // name is kept as a fallback. Reading only the old name silently skipped this delete (K1).
    const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && serviceKey) {
      await fetch(`${url}/auth/v1/admin/users/${user.id}`, {
        method: 'DELETE',
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      }).catch(() => {});
    }
    // NOTE: live Printful sync products + active Stripe subscriptions are not auto-removed here
    // (they need their own API calls) — clean those up out of band if a creator had a live store.
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
