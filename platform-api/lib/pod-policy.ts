// ⚠️ COPY of src/lib/pod-policy.ts — keep IN SYNC (platform-api can't import from the app repo,
// same as db/schema.ts). Edit both when the policy changes.
//
// POD (print-on-demand) / MANUFACTURER FULFILLMENT content policy — separate from generation safety.
//
// `lib/content-safety.ts` governs what we'll GENERATE (permissive: creators own their designs,
// including any copyright/IP). THIS module governs what a FULFILLER will PRINT + SHIP — a built-in
// POD provider today (Printful, Printify), and soon a connected white-label MANUFACTURER. Each
// fulfiller has its OWN, stricter content rules, so a design we happily generate (nudity, a brand
// parody, edgy politics) may still be REFUSED at fulfillment. We screen at PRODUCT LAUNCH (and again
// before an order ships), keyed to the resolved provider — so the creator hears it at publish time,
// not after a customer pays.
//
// WHY PER-PROVIDER (not one global rule): fulfillers disagree. Printful *warns* on third-party IP;
// another may hard-*block* it; a connected manufacturer sets their own line. Baking any of that into
// generation would impose a standard no single fulfiller universally upholds. So generation stays
// provider-agnostic and the fulfiller-specific gate lives HERE, resolved per store/product.
//
// ROADMAP — manufacturer connect: when manufacturers connect via the API to list their white-label
// products, each brings its own AcceptableContent policy (stored in the DB at connect time). That
// policy is a `ProviderPolicy` like the built-ins below; load it and pass it straight to
// `checkProviderPolicy(policy, text)` — no registry edit, no code change per manufacturer. The
// built-in POD providers stay in `POD_PROVIDERS`; connected manufacturers resolve to their own id +
// DB-loaded policy. See docs/accounts/POD_POLICY.md.
//
// EXTENDING (built-in provider): add a `ProviderPolicy` to `POD_PROVIDERS`. Every call site (the
// publish gate, the fulfillment guard) reads this module unchanged.
//
// NOTE: `platform-api/lib/pod-policy.ts` is a COPY of this file (the fulfillment safety-net runs in
// platform-api). Keep the two in sync on every change — same discipline as the schema copy.

export type BuiltinProvider = 'printful' | 'printify';
// A provider id is a built-in POD or, soon, a connected manufacturer's id (arbitrary at runtime).
// The `(string & {})` keeps editor autocomplete for the built-ins while accepting any string.
export type PodProvider = BuiltinProvider | (string & {});

export type Severity = 'block' | 'warn';
export type PolicyViolation = { category: string; severity: Severity; reason: string };

export type Rule = { category: string; severity: Severity; test: RegExp; reason: string };

export type ProviderPolicy = {
  id: PodProvider;
  name: string;
  policyUrl: string;
  rules: Rule[];
};

// Printful — https://www.printful.com/policies/acceptable-content. Hard-prohibited: pornographic,
// hateful/discriminatory, violence/terrorism promotion, self-harm promotion. Restricted (warn):
// hard-drug promotion, and third-party IP / trademarks / celebrity likeness (the #1 real-world
// rejection — but unreliable to detect from text, so a warning, not a block).
const PRINTFUL: ProviderPolicy = {
  id: 'printful',
  name: 'Printful',
  policyUrl: 'https://www.printful.com/policies/acceptable-content',
  rules: [
    {
      category: 'pornographic',
      severity: 'block',
      test: /\b(porn|pornographic|pornhub|xxx|hardcore\s*porn|hentai|rule\s?34|blowjob|cumshot|cum\s*shot|deepthroat|gangbang|creampie|explicit\s+sex(ual)?|sexually\s+explicit)\b/i,
      reason: 'Printful will not print pornographic / sexually explicit designs.',
    },
    {
      category: 'hate',
      severity: 'block',
      test: /\b(nazi|swastika|heil\s+hitler|kkk|ku\s+klux\s+klan|white\s+power|white\s+supremac\w*|genocide|ethnic\s+cleansing|racial\s+slur)\b/i,
      reason: 'Printful prohibits hateful, discriminatory, or extremist content.',
    },
    {
      category: 'violence_terror',
      severity: 'block',
      test: /\b(terroris[mt]|isis|al[\s-]?qaeda|how\s+to\s+(make|build)\s+a\s+bomb|bomb[\s-]?making|mass\s+shooting|incite\s+violence|behead(ing)?)\b/i,
      reason: 'Printful prohibits content that promotes violence or terrorism.',
    },
    {
      category: 'self_harm',
      severity: 'block',
      test: /\b(pro[\s-]?ana|pro[\s-]?mia|suicide\s+(method|guide|how\s+to)|self[\s-]?harm\s+(guide|how\s+to|encourag))\b/i,
      reason: 'Printful prohibits content that promotes self-harm.',
    },
    {
      category: 'illegal_drugs',
      severity: 'warn',
      test: /\b(cocaine|heroin|methamphetamine|how\s+to\s+(make|cook)\s+(meth|drugs)|sell\s+drugs)\b/i,
      reason: 'Hard-drug content is restricted by Printful and may be declined (cannabis art is usually fine).',
    },
    {
      category: 'ip_trademark',
      severity: 'warn',
      test: /\b(disney|marvel|pixar|pok[eé]mon|nintendo|star\s+wars|nike|adidas|gucci|louis\s+vuitton|chanel|supreme|coca[\s-]?cola|nfl|nba|(registered\s+)?trademark|copyrighted)\b/i,
      reason: 'May depict third-party IP / a trademark. Printful declines unauthorized IP — only proceed if you hold the rights.',
    },
  ],
};

// Printify — https://printify.com/legal/acceptable-use-policy/. Mirrors the universal hard blocks
// (porn / hate / violence) with its own wording, and DIFFERS from Printful by also restricting the
// promotion/sale of regulated goods (firearms, ammo, tobacco/vape) — a concrete example of why this
// policy is per-provider, not global. IP/trademark is a warn here too (undetectable from text alone).
const PRINTIFY: ProviderPolicy = {
  id: 'printify',
  name: 'Printify',
  policyUrl: 'https://printify.com/legal/acceptable-use-policy/',
  rules: [
    {
      category: 'pornographic',
      severity: 'block',
      test: /\b(porn|pornographic|pornhub|xxx|hardcore\s*porn|hentai|rule\s?34|blowjob|cumshot|cum\s*shot|deepthroat|gangbang|creampie|explicit\s+sex(ual)?|sexually\s+explicit)\b/i,
      reason: 'Printify will not print pornographic / sexually explicit designs.',
    },
    {
      category: 'hate',
      severity: 'block',
      test: /\b(nazi|swastika|heil\s+hitler|kkk|ku\s+klux\s+klan|white\s+power|white\s+supremac\w*|genocide|ethnic\s+cleansing|racial\s+slur)\b/i,
      reason: 'Printify prohibits hateful, discriminatory, or extremist content.',
    },
    {
      category: 'violence_terror',
      severity: 'block',
      test: /\b(terroris[mt]|isis|al[\s-]?qaeda|how\s+to\s+(make|build)\s+a\s+bomb|bomb[\s-]?making|mass\s+shooting|incite\s+violence|behead(ing)?)\b/i,
      reason: 'Printify prohibits content that promotes violence or terrorism.',
    },
    {
      category: 'self_harm',
      severity: 'block',
      test: /\b(pro[\s-]?ana|pro[\s-]?mia|suicide\s+(method|guide|how\s+to)|self[\s-]?harm\s+(guide|how\s+to|encourag))\b/i,
      reason: 'Printify prohibits content that promotes self-harm.',
    },
    {
      // Printify-specific divergence: restricts the SALE/promotion of regulated goods. Imagery alone
      // is usually fine, so this is a warn, not a block.
      category: 'regulated_goods',
      severity: 'warn',
      test: /\b((buy|sell|sale|selling|shop)\s+(guns?|firearms?|ammo|ammunition)|firearm\s+sales|(vape|vaping|e[\s-]?cigarette)\s+(shop|sale|sales)|sell\s+(tobacco|cigarettes))\b/i,
      reason: 'Printify restricts the promotion/sale of regulated goods (firearms, ammunition, tobacco/vape). Imagery is usually fine; explicit sale promotion may be declined.',
    },
    {
      category: 'ip_trademark',
      severity: 'warn',
      test: /\b(disney|marvel|pixar|pok[eé]mon|nintendo|star\s+wars|nike|adidas|gucci|louis\s+vuitton|chanel|supreme|coca[\s-]?cola|nfl|nba|(registered\s+)?trademark|copyrighted)\b/i,
      reason: 'May depict third-party IP / a trademark. Printify declines unauthorized IP — only proceed if you hold the rights.',
    },
  ],
};

// Built-in POD providers. Connected manufacturers are NOT registered here — their policy is loaded
// from the DB at request time and passed straight to checkProviderPolicy(policy, …).
const POD_PROVIDERS: Record<string, ProviderPolicy> = {
  [PRINTFUL.id]: PRINTFUL,
  [PRINTIFY.id]: PRINTIFY,
};

/** Every built-in provider policy (e.g. for a settings/policy-links screen). */
export function listProviderPolicies(): ProviderPolicy[] {
  return Object.values(POD_PROVIDERS);
}

/** Resolve which provider a store/product fulfills through. Single built-in default today; when
 *  stores/products carry a provider — a built-in id OR a connected-manufacturer id — resolve it
 *  here and every call site stays unchanged. */
export function resolvePodProvider(_opts?: { storeId?: string; productId?: string }): PodProvider {
  return 'printful';
}

export type PolicyResult = {
  provider: PodProvider;
  ok: boolean; // no BLOCK-level violations (warnings don't flip this)
  blocks: PolicyViolation[];
  warnings: PolicyViolation[];
};

function evaluate(policy: ProviderPolicy, text: string): PolicyResult {
  const t = text.normalize('NFKC');
  const blocks: PolicyViolation[] = [];
  const warnings: PolicyViolation[] = [];
  for (const r of policy.rules) {
    if (r.test.test(t)) {
      const v: PolicyViolation = { category: r.category, severity: r.severity, reason: r.reason };
      (r.severity === 'block' ? blocks : warnings).push(v);
    }
  }
  return { provider: policy.id, ok: blocks.length === 0, blocks, warnings };
}

/**
 * Screen the combined text of a product (name + description + design prompts) against a fulfiller's
 * content policy. Pass a built-in provider id (looked up in POD_PROVIDERS) OR a `ProviderPolicy`
 * object directly — the latter is how a connected manufacturer's DB-loaded policy is screened
 * without touching the registry. `blocks` should stop a publish/fulfillment; `warnings` are surfaced
 * to the creator but don't block. Unknown provider id → permissive (ok:true) so a config gap never
 * silently blocks legitimate sales.
 */
export function checkProviderPolicy(
  providerOrPolicy: PodProvider | ProviderPolicy,
  text: string | null | undefined,
): PolicyResult {
  const policy = typeof providerOrPolicy === 'string' ? POD_PROVIDERS[providerOrPolicy] : providerOrPolicy;
  const providerId = typeof providerOrPolicy === 'string' ? providerOrPolicy : providerOrPolicy.id;
  if (!policy || !text) return { provider: providerId, ok: true, blocks: [], warnings: [] };
  return evaluate(policy, text);
}

export function providerPolicyUrl(provider: PodProvider): string | null {
  return POD_PROVIDERS[provider]?.policyUrl ?? null;
}
