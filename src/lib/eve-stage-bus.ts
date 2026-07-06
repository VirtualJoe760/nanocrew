// THE EVE STAGE BUS — the voice surface drives the ONE persistent background avatar.
//
// Since the overlay retirement there is exactly one GL avatar, mounted at the app root
// (eve-background.tsx). Surfaces that used to mount their own (eve-home) now PUSH her lifecycle
// here instead. Same module-level current-value + listener idiom as the other buses: THREE-free,
// and a late subscriber (the lazy GL mount) is handed the current value immediately.
//
// The vocabulary is deliberately clamped to 'silence' | 'talking'. 'pre-render' is meaningless for
// an always-on background (she never waits un-assembled), and 'morphing' is DESTRUCTIVE on a formed
// scene — it ping-pongs the reveal target, visibly disintegrating the app background (the full
// four-stage contract remains available to the Lab, which mounts its own scene).

export type EveStage = 'silence' | 'talking';

let stage: EveStage = 'silence';
const listeners = new Set<(s: EveStage) => void>();

/** Push the background avatar's energy state. She calms to 'silence' when nothing drives her. */
export function setEveStage(next: EveStage): void {
  if (next === stage) return;
  stage = next;
  listeners.forEach((fn) => fn(stage));
}

/** The root background subscribes here and is handed the current stage immediately. */
export function subscribeEveStage(fn: (s: EveStage) => void): () => void {
  listeners.add(fn);
  fn(stage);
  return () => {
    listeners.delete(fn);
  };
}
