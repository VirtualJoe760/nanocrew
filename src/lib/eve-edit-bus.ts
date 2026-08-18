// NEXT-TURN CAPTURE — "tell Eve the edit": a surface arms this, and the creator's NEXT spoken
// (or typed) utterance is handed to the callback as an edit instruction instead of going through
// the intent router. One-shot, disarmed on delivery or explicitly. Sibling of eve-say-bus.
//
// This is C3b's first slice (spoken design iteration): EveDesign arms it from its "Tell Eve"
// tool; eve-home's routing effect consumes it before routeTurn.

let pending: ((turn: string) => void) | null = null;

/** Arm: the next user turn goes to `cb` instead of intent routing. Returns a disarm fn. */
export function armNextTurn(cb: (turn: string) => void): () => void {
  pending = cb;
  return () => {
    if (pending === cb) pending = null;
  };
}

/** eve-home calls this per committed user turn. True = consumed (skip routing). */
export function consumeNextTurn(turn: string): boolean {
  if (!pending) return false;
  const cb = pending;
  pending = null;
  cb(turn);
  return true;
}
