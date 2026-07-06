// THE EVE CAPABILITY REGISTRY — the app modeled as a decision tree (docs/studio/EVE_CONTROL.md).
//
// One hand-authored source of truth for "what can the creator do," read by BOTH front-ends:
//   · the energy-orb UI (eve-orbs.tsx) renders the visible nodes and traverses branches on tap
//   · voice (/api/eve/route) resolves an utterance to an intent, which links back to a node
//
// Before this, the same choices were triplicated across venus-guide's chips, the route's intent
// enum, and eve-home's routeTurn switch — they drifted. The registry collapses them: a node owns
// its label, icon, availability (`when`), children (for branches), and a pure ACTION DESCRIPTOR
// that eve-home interprets (eve-home holds the app handlers — router, the design bus, the live
// session — so the registry stays pure data + predicates and never imports the UI).
//
// Node kinds (the grammar): branch (blooms its children into more orbs) · pick (opens a real
// selection screen and returns a value) · prompt (Eve asks free input) · act (fires a capability).

export type EveNodeKind = 'branch' | 'pick' | 'prompt' | 'act';
export type EveIcon = 'brand' | 'edit' | 'design' | 'meme' | 'post' | 'store' | 'digest' | 'nav';

/** The world the registry decides against — the same shape eve-home already computes from /api/me. */
export type EveCtx = {
  hasStore: boolean;
  stores: { name: string; slug: string; status: string }[];
};

/** What a leaf node DOES — a pure descriptor; eve-home's runNode() turns it into router/bus/session
 *  calls. edit-site carries no slug (which store + whether it has a live site is resolved where the
 *  URL helpers live, in eve-home). Branch nodes have no action — tapping one blooms its children. */
export type EveAction =
  | { type: 'build-brand' }
  | { type: 'edit-site' }
  | { type: 'new-design'; meme?: boolean }
  | { type: 'write-post' }
  | { type: 'manage-brand' }
  | { type: 'nav'; route: string };

export type EveNode = {
  id: string;
  label: string;
  detail?: string;
  kind: EveNodeKind;
  icon: EveIcon;
  /** Links a /api/eve/route intent to this node so voice and taps converge (dedup). */
  voiceIntent?: string;
  /** Availability — absorbs venus-guide's store-status logic. */
  when: (ctx: EveCtx) => boolean;
  /** Child node ids (branch only) — bloom on tap. */
  children?: string[];
  /** Leaf action (act/prompt/pick). Absent on branches. */
  action?: (ctx: EveCtx) => EveAction;
};

const NODES: Record<string, EveNode> = {
  'build-brand': {
    id: 'build-brand',
    label: 'Build a brand',
    detail: 'Talk it through — I design the rest.',
    kind: 'act', // fires the interview flow
    icon: 'brand',
    voiceIntent: 'create-brand',
    when: () => true,
    action: () => ({ type: 'build-brand' }),
  },
  'edit-site': {
    id: 'edit-site',
    label: 'Edit your site',
    detail: 'Change anything on the page.',
    kind: 'act', // fires the developing state
    icon: 'edit',
    voiceIntent: 'edit-site',
    when: (c) => c.hasStore,
    action: () => ({ type: 'edit-site' }),
  },
  'manage-brand': {
    id: 'manage-brand',
    label: 'Manage',
    detail: 'Posts, products, settings.',
    kind: 'act',
    icon: 'store',
    when: (c) => c.hasStore,
    action: () => ({ type: 'manage-brand' }),
  },
  'new-design': {
    id: 'new-design',
    label: 'New design',
    detail: 'Fresh graphics for your next drop.',
    kind: 'prompt',
    icon: 'design',
    voiceIntent: 'new-design',
    when: () => true,
    action: () => ({ type: 'new-design' }),
  },
  'make-meme': {
    id: 'make-meme',
    label: 'Make a meme',
    detail: 'Social-ready — brand, internet-native.',
    kind: 'prompt',
    icon: 'meme',
    when: () => true,
    action: () => ({ type: 'new-design', meme: true }),
  },
  'write-post': {
    id: 'write-post',
    label: 'Write a post',
    detail: 'A post for your site.',
    kind: 'prompt',
    icon: 'post',
    voiceIntent: 'write-post',
    when: (c) => c.hasStore,
    action: () => ({ type: 'write-post' }),
  },
  // Branch: brand management, grouped so the root ring stays calm for returning creators.
  'brand': {
    id: 'brand',
    label: 'Brand',
    detail: 'Your site, another brand, settings.',
    kind: 'branch',
    icon: 'brand',
    when: (c) => c.hasStore,
    children: ['edit-site', 'build-brand', 'manage-brand'],
  },
};

/** The root ring — contextual by store status. First-timers see the direct build + create verbs;
 *  returning creators get a Brand branch (grouping site/new-brand/manage) alongside create + post. */
export function eveRootNodes(ctx: EveCtx): EveNode[] {
  const ids = ctx.hasStore
    ? ['brand', 'new-design', 'make-meme', 'write-post']
    : ['build-brand', 'new-design', 'make-meme'];
  return ids
    .map((id) => NODES[id])
    .filter((n) => n && n.when(ctx))
    .slice(0, 4);
}

/** The visible children of a branch node (filtered by availability). */
export function eveChildren(node: EveNode, ctx: EveCtx): EveNode[] {
  return (node.children ?? []).map((id) => NODES[id]).filter((n) => n && n.when(ctx));
}

/** The node a voice intent maps to (so the router and the orbs share one dispatch catalog). */
export function eveNodeForIntent(intent: string): EveNode | undefined {
  return Object.values(NODES).find((n) => n.voiceIntent === intent);
}
