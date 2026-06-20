import type { BrandJsonPatch } from '@/lib/brand-config';

// SINGLE SOURCE OF TRUTH for editing a brand's identity (name / tagline / story).
//
// A brand's identity is duplicated across many surfaces — the `stores` columns (name, tagline,
// description_md, logo_url, og_image_url), the `brand_profile` jsonb (AI ground-truth: name, story,
// logo.direction), the mini-CMS `site_config.copy` overrides (which WIN on the live site), and the
// per-brand repo's baked `brand.json` (which drives the site header + SEO/meta/JSON-LD). An edit to
// ONE field must cascade to ALL of them, or the brand drifts — e.g. a rename to "Alpha Patriot" that
// leaves "Alpha Master" in the SEO description, the About paragraph, and the AI prompt seed.
//
// `buildBrandPatch()` computes that whole cascade in one place so every caller stays consistent:
//   • explicit field edits win;
//   • on a RENAME, the old brand name is swapped → new everywhere it's embedded in copy;
//   • the baked logo + OG card (which embed the old identity) are cleared so they get regenerated.
// The route applies `dbPatch` (one stores UPDATE) and pushes `brandJson` (one brand.json write).

export function renameInText(text: string, from: string, to: string): string {
  if (!text || !from || from === to) return text;
  return text.split(from).join(to);
}

type StoreLike = {
  name: string;
  tagline: string | null;
  descriptionMd: string | null;
  brandProfile: unknown;
  siteConfig: unknown;
};

export type BrandEditBody = { name?: string; tagline?: string; descriptionMd?: string; isPublic?: boolean };

export type BrandCascade = {
  dbPatch: Record<string, unknown>; // columns to UPDATE on the stores row
  brandJson: BrandJsonPatch | null; // brand.json fields to push (null = nothing baked changed)
  identityChanged: boolean; // name/tagline/story changed → push brand.json + revalidate
  nameChanged: boolean;
};

export function buildBrandPatch(store: StoreLike, body: BrandEditBody): BrandCascade {
  const dbPatch: Record<string, unknown> = {};
  const oldName = store.name;

  // --- 1) Direct column edits ----------------------------------------------------------------
  let name = store.name;
  if (typeof body.name === 'string' && body.name.trim()) {
    name = body.name.trim().slice(0, 120);
    if (name !== store.name) dbPatch.name = name;
  }
  const nameChanged = name !== oldName;

  // tagline: explicit edit, else swap the old brand name inside the existing tagline on rename.
  const taglineEdited = typeof body.tagline === 'string';
  let tagline = store.tagline;
  if (taglineEdited) tagline = body.tagline!.trim().slice(0, 200) || null;
  else if (nameChanged && store.tagline) tagline = renameInText(store.tagline, oldName, name);
  if (tagline !== store.tagline) dbPatch.tagline = tagline;

  // story (description_md = THE source of truth): explicit edit, else rename-swap on rename.
  const storyEdited = typeof body.descriptionMd === 'string';
  let story = store.descriptionMd;
  if (storyEdited) story = body.descriptionMd!.trim() || null;
  else if (nameChanged && store.descriptionMd) story = renameInText(store.descriptionMd, oldName, name);
  if (story !== store.descriptionMd) dbPatch.descriptionMd = story;

  if (typeof body.isPublic === 'boolean') dbPatch.isPublic = body.isPublic;

  // --- 2) brand_profile (AI ground-truth: read by enhance-copy / build-site) ------------------
  if (nameChanged || dbPatch.descriptionMd !== undefined) {
    const bp = { ...((store.brandProfile as Record<string, unknown>) ?? {}) };
    if (nameChanged) {
      bp.name = name;
      const logo = bp.logo as { direction?: string } | undefined;
      if (logo && typeof logo.direction === 'string') {
        bp.logo = { ...logo, direction: renameInText(logo.direction, oldName, name) };
      }
    }
    if (dbPatch.descriptionMd !== undefined) bp.story = story ?? '';
    else if (nameChanged && typeof bp.story === 'string') bp.story = renameInText(bp.story, oldName, name);
    dbPatch.brandProfile = bp;
  }

  // --- 3) mini-CMS overrides (site_config.copy) — these WIN on the live site -------------------
  if (nameChanged || dbPatch.descriptionMd !== undefined || taglineEdited) {
    const sc = { ...((store.siteConfig as Record<string, unknown>) ?? {}) };
    const copy = { ...((sc.copy as Record<string, string>) ?? {}) };
    let copyChanged = false;
    if (dbPatch.descriptionMd !== undefined && typeof copy.story === 'string') {
      copy.story = story ?? '';
      copyChanged = true;
    }
    if (taglineEdited && typeof copy.tagline === 'string') {
      copy.tagline = tagline ?? '';
      copyChanged = true;
    }
    if (nameChanged) {
      // any override copy embedding the old name (headline, subline, kicker, cta, story, tagline)
      for (const k of Object.keys(copy)) {
        if (typeof copy[k] === 'string' && copy[k].includes(oldName)) {
          copy[k] = renameInText(copy[k], oldName, name);
          copyChanged = true;
        }
      }
    }
    if (copyChanged) {
      sc.copy = copy;
      dbPatch.siteConfig = sc;
    }
  }

  // --- 4) On rename, the baked logo + OG card embed the old identity → clear them --------------
  if (nameChanged) {
    dbPatch.logoUrl = null;
    dbPatch.ogImageUrl = null;
  }

  // --- 5) Baked brand.json (site header + SEO/meta/JSON-LD) — push whatever identity changed ---
  const identityChanged = nameChanged || dbPatch.tagline !== undefined || dbPatch.descriptionMd !== undefined;
  let brandJson: BrandJsonPatch | null = null;
  if (identityChanged) {
    brandJson = {};
    if (nameChanged) {
      brandJson.name = name;
      brandJson.logoUrl = '';
    }
    if (dbPatch.tagline !== undefined) brandJson.tagline = tagline;
    if (dbPatch.descriptionMd !== undefined) brandJson.story = story;
  }

  return { dbPatch, brandJson, identityChanged, nameChanged };
}
