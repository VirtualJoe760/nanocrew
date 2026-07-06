// THE EVE CAPABILITY REGISTRY — the app modeled as a decision tree (docs/studio/EVE_CONTROL.md).
//
// One hand-authored source of truth for "what can the creator do," read by BOTH front-ends:
//   · the energy-orb UI (eve-orbs.tsx) renders the visible nodes and fires them on tap
//   · voice (/api/eve/route) resolves an utterance to an intent, which links back to a node
//
// Before this, the same choices were triplicated across venus-guide's chips, the route's intent
// enum, and eve-home's routeTurn switch — they drifted. The registry collapses them: a node owns
// its label, icon, availability (`when`), and a pure ACTION DESCRIPTOR that eve-home interprets
// (eve-home holds the app handlers — router, the design bus, the live session — so the registry
// stays pure data + predicates and never imports the UI).
//
// Node kinds (the grammar): branch (blooms more orbs) · pick (opens a real selection screen and
// returns a value) · prompt (Eve asks free input) · act (fires a capability immediately).

export type EveNodeKind = 'branch' | 'pick' | 'prompt' | 'act';
export type EveIcon = 'brand' | 'edit' | 'design' | 'meme' | 'post' | 'digest' | 'nav';

/** The world the registry decides against — the same shape eve-home already computes from /api/me. */
export type EveCtx = {
  hasStore: boolean;
  stores: { name: string; slug: string; status: string }[];
};

/** What a node DOES — a pure descriptor; eve-home's runNode() turns it into router/bus/session calls.
 *  edit-site carries no slug (which store + whether it has a live site is resolved where the URL
 *  helpers live, in eve-home). */
export type EveAction =
  | { type: 'build-brand' }
  | { type: 'edit-site' }
  | { type: 'new-design'; meme?: boolean }
  | { type: 'write-post' }
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
  action: (ctx: EveCtx) => EveAction;
};

// The root ring — the home-state orbs. Order = display order; `when` decides which bloom.
// Faithful to venus-guide's prior logic: first-timers get Build; returning creators get Edit.
const ROOT: EveNode[] = [
  {
    id: 'build-brand',
    label: 'Build a brand',
    detail: 'Talk it through — I design the rest.',
    kind: 'branch',
    icon: 'brand',
    voiceIntent: 'create-brand',
    when: (c) => !c.hasStore,
    action: () => ({ type: 'build-brand' }),
  },
  {
    id: 'edit-site',
    label: 'Edit your site',
    detail: 'Change anything on the page.',
    kind: 'branch',
    icon: 'edit',
    voiceIntent: 'edit-site',
    when: (c) => c.hasStore,
    action: () => ({ type: 'edit-site' }),
  },
  {
    id: 'new-design',
    label: 'Create a design',
    detail: 'Fresh graphics for your next drop.',
    kind: 'prompt',
    icon: 'design',
    voiceIntent: 'new-design',
    when: () => true,
    action: () => ({ type: 'new-design' }),
  },
  {
    id: 'make-meme',
    label: 'Make a meme',
    detail: 'Social-ready — brand, internet-native.',
    kind: 'prompt',
    icon: 'meme',
    voiceIntent: 'new-design',
    when: () => true,
    action: () => ({ type: 'new-design', meme: true }),
  },
  {
    id: 'write-post',
    label: 'Write a post',
    detail: 'A post for your site.',
    kind: 'prompt',
    icon: 'post',
    voiceIntent: 'write-post',
    when: (c) => c.hasStore,
    action: () => ({ type: 'write-post' }),
  },
];

/** The orbs that should bloom right now — capped at 4 so the ring never becomes a wall. */
export function visibleEveNodes(ctx: EveCtx): EveNode[] {
  return ROOT.filter((n) => n.when(ctx)).slice(0, 4);
}

/** The node a voice intent maps to (so the router and the orbs share one dispatch). */
export function eveNodeForIntent(intent: string): EveNode | undefined {
  return ROOT.find((n) => n.voiceIntent === intent);
}
