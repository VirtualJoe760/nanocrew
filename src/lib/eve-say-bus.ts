// EVE'S CUE CARD — a one-way bus for making her SPEAK from a surface that doesn't own her session.
//
// Sibling of eve-vision-bus (same module-level-listener idiom, same reason): EveDesign renders in
// an overlay; the Gemini Live session lives in EveHome underneath. The surface publishes a stage
// direction (an INTENT for her to voice, never a script to recite — see EVE_VOICE) and EveHome
// forwards it to live.prompt(), which sends it as a completed turn so she actually replies aloud.
//
// DELIBERATELY NOT QUEUED, like the vision bus: if she isn't live the cue is DROPPED. A question
// voiced minutes after the moment passed is worse than silence.

let listener: ((instruction: string) => void) | null = null;

/** Ask Eve to say something now (an instruction, e.g. "(Ask whether to enhance it or print as-is.)").
 *  No-op when she isn't live — by design. */
export function sayEve(instruction: string): void {
  listener?.(instruction);
}

/** EveHome registers on mount; returns the unsubscribe. */
export function registerEveSayListener(fn: (instruction: string) => void): () => void {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}
