// THE EVE BUS — how the rest of the app summons (and hears from) Eve, the full-screen overlay
// assistant (docs/archive/VENUS_CENTRAL.md). Same module-level queue+listener idiom as the design
// command bus: senders never import the overlay, and a summon fired before the overlay mounts
// flushes on mount.
//
// Eve's STATES (the machine lives on the Eve tab, studio.tsx):
//   hidden     — overlay off-screen; the top-edge handle is armed
//   home       — her steady state: full-screen orb, greeting + tools, the brand interview
//   developing — site-editing UI (Phase B)
//   design     — hands-free design view/edit (Phase C)
//   assets     — hands-free WEBSITE-graphic flow (the ASSETS spoke; hero/logo/social)

export type EveState = 'hidden' | 'home' | 'developing' | 'design' | 'assets';

export type EveSummon = {
  state: Exclude<EveState, 'hidden'>;
  /** Optional state payload — e.g. { slug } for developing (Phase B). */
  payload?: Record<string, unknown>;
};

/** Things Eve did that the app beneath may care about (e.g. the Studio dashboard refetches). */
export type EveEvent = { kind: 'store-created'; slug: string } | { kind: 'dismissed' };

let summonListener: ((s: EveSummon) => void) | null = null;
let queuedSummon: EveSummon | null = null;
const eventListeners = new Set<(e: EveEvent) => void>();

/** Bring Eve up in the given state (default: home). Queued until the overlay mounts. */
export function summonEve(summon: EveSummon = { state: 'home' }): void {
  if (summonListener) summonListener(summon);
  else queuedSummon = summon;
}

/** The overlay registers here on mount; a queued summon flushes immediately. */
export function registerEveSummonListener(fn: (s: EveSummon) => void): () => void {
  summonListener = fn;
  if (queuedSummon) {
    const s = queuedSummon;
    queuedSummon = null;
    fn(s);
  }
  return () => {
    if (summonListener === fn) summonListener = null;
  };
}

/** Eve announces app-relevant outcomes (fire-and-forget; no queue — miss it, refetch on focus). */
export function emitEveEvent(e: EveEvent): void {
  eventListeners.forEach((fn) => fn(e));
}

export function addEveEventListener(fn: (e: EveEvent) => void): () => void {
  eventListeners.add(fn);
  return () => {
    eventListeners.delete(fn);
  };
}
