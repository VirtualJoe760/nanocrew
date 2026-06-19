// POD (print-on-demand) FULFILLMENT content policy — separate from generation safety.
//
// `lib/content-safety.ts` governs what we'll GENERATE (permissive: creators own their designs).
// This module governs what a MANUFACTURER will PRINT + SHIP. Each POD provider has its own,
// stricter content rules, so a design we happily generate (e.g. nudity, a brand parody, edgy
// politics) may still be REFUSED by the provider when an order is placed. We screen here BEFORE a
// product goes live / an order is fulfilled, so the creator finds out at publish time — not after a
// customer pays and the provider rejects the order.
//
// Providers offer no real-time "will you accept this?" API, so this is a best-effort HEURISTIC from
// each provider's published Acceptable-Content guidelines, run over the text we have (product name,
// description, and each design's generation prompt). It catches the common, clearly-prohibited
// cases; it is NOT a substitute for the provider's own review.
//
// EXTENDING: adding a provider = add a `ProviderPolicy` entry to POD_PROVIDERS, keyed by its id.
// Everything else (the publish gate, the checkout/fulfillment guard) reads this registry.

export type PodProvider = 'printful'; // extend: | 'printify' | 'gooten' | 'gelato' | ...

export type Severity = 'block' | 'warn';
export type PolicyViolation = { category: string; severity: Severity; reason: string };

type Rule = { category: string; severity: Severity; test: RegExp; reason: string };

type ProviderPolicy = {
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

const POD_PROVIDERS: Record<PodProvider, ProviderPolicy> = {
  printful: PRINTFUL,
};

/** Resolve which provider a store/product fulfills through. Single provider today; when we add
 *  more, resolve from the store/product record here so every call site stays unchanged. */
export function resolvePodProvider(_opts?: { storeId?: string }): PodProvider {
  return 'printful';
}

export type PolicyResult = {
  provider: PodProvider;
  ok: boolean; // no BLOCK-level violations (warnings don't flip this)
  blocks: PolicyViolation[];
  warnings: PolicyViolation[];
};

/**
 * Screen the combined text of a product (name + description + design prompts) against a provider's
 * fulfillment content policy. `blocks` should stop a publish/fulfillment; `warnings` are surfaced
 * to the creator but don't block. Unknown provider → permissive (ok:true) so a config gap never
 * silently blocks legitimate sales.
 */
export function checkProviderPolicy(provider: PodProvider, text: string | null | undefined): PolicyResult {
  const policy = POD_PROVIDERS[provider];
  const empty: PolicyResult = { provider, ok: true, blocks: [], warnings: [] };
  if (!policy || !text) return empty;
  const t = text.normalize('NFKC');
  const blocks: PolicyViolation[] = [];
  const warnings: PolicyViolation[] = [];
  for (const r of policy.rules) {
    if (r.test.test(t)) {
      const v: PolicyViolation = { category: r.category, severity: r.severity, reason: r.reason };
      (r.severity === 'block' ? blocks : warnings).push(v);
    }
  }
  return { provider, ok: blocks.length === 0, blocks, warnings };
}

export function providerPolicyUrl(provider: PodProvider): string | null {
  return POD_PROVIDERS[provider]?.policyUrl ?? null;
}
