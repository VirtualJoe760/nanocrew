// THE EVE BACKGROUND GATE — one bit: is a full-screen surface covering the persistent Eve?
//
// Since THE PIVOT (docs/studio/EVE_CONTROL.md) Eve is the app's living background: her ONE GL avatar
// mounts at the root (eve-background.tsx) behind the tab pages. The pull-down overlay (eve-overlay)
// still slides a full-screen surface OVER the tabs and mounts its OWN avatar for the home/interview.
// To keep exactly ONE GL context alive at a time — the hard constraint the whole scene is built on —
// the root avatar YIELDS (unmounts) while that overlay is up, then remounts when it closes. Same
// module-level current-value + listener idiom as eve-bus: THREE-free, and a late subscriber (the lazy
// GL mount) reads the current value immediately.

let covered = false;
const listeners = new Set<(covered: boolean) => void>();

/** The overlay reports whether it is currently covering the screen (mounted). */
export function setEveCovered(next: boolean): void {
  if (next === covered) return;
  covered = next;
  listeners.forEach((fn) => fn(covered));
}

export function isEveCovered(): boolean {
  return covered;
}

/** The root background subscribes here and is handed the current value immediately. */
export function subscribeEveCovered(fn: (covered: boolean) => void): () => void {
  listeners.add(fn);
  fn(covered);
  return () => {
    listeners.delete(fn);
  };
}
