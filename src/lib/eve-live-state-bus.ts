// EVE'S PULSE — broadcast of her live-session state + current caption so surfaces layered OVER
// her (the design pipeline's pickers, placement, finalize) can show a truthful "she's listening"
// badge (EveEar) and her SUBTITLES (EveCaptions) — she never goes dark behind her own popups
// (Joe, 2026-08-17). eve-home publishes; anyone subscribes. Sibling of eve-stage-bus.
import type { LiveState } from '@/lib/live-voice';

export type EvePulse = { state: LiveState | 'off'; caption: string; muted?: boolean };
let current: EvePulse = { state: 'off', caption: '' };
const subs = new Set<(p: EvePulse) => void>();

export function publishEvePulse(p: EvePulse): void {
  current = p;
  for (const fn of subs) fn(p);
}
export function subscribeEvePulse(fn: (p: EvePulse) => void): () => void {
  subs.add(fn);
  fn(current);
  return () => { subs.delete(fn); };
}

// Tap-to-mute from the badge (Joe, 2026-08-17): surfaces request, eve-home applies.
let muteListener: (() => void) | null = null;
export function toggleEveMute(): void {
  muteListener?.();
}
export function registerEveMuteListener(fn: () => void): () => void {
  muteListener = fn;
  return () => { if (muteListener === fn) muteListener = null; };
}
