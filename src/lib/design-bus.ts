// THE DESIGN COMMAND BUS — the design tab's programmatic control surface.
//
// Anything in the app (deep links today; VENUS tomorrow — docs/archive/VENUS_CENTRAL.md) can
// drive the design canvas without touching its internals: open the generator prefilled, land an
// externally-generated image (e.g. a meme Venus made in conversation) in the current collection,
// put it on the canvas, and pull it up in the editor for immediate review.
//
// Pattern: module-level queue + listener (the venus-orb-bus idiom, queued) — commands sent while
// the design screen is unmounted FLUSH when it mounts, so "Venus generates from the Studio tab →
// user hops to Design" just works. Deep-link translation lives in design.tsx
// (?action=generate&prompt=…&meme=1 and ?edit=<designId>), so there is ONE code path.

export type DesignCommand =
  | {
      kind: 'open-generate';
      /** Prefill the generator's prompt (user still reviews/edits before running). */
      prompt?: string;
      /** Steer into classic meme format (the generator's meme toggle). */
      meme?: boolean;
    }
  | {
      /** Put an existing design on the canvas and fly the camera to it. */
      kind: 'show-design';
      designId: string;
    }
  | {
      /** Open the design editor on an existing design (optionally with a prefilled instruction). */
      kind: 'open-editor';
      designId: string;
      instruction?: string;
    }
  | {
      /** Land an externally-generated image (hosted URL or data:) in the CURRENT collection —
       *  persists via /api/designs, appears in the dock, optionally hits the canvas + editor.
       *  This is Venus's "here's your meme — want to tweak it?" path. */
      kind: 'ingest-design';
      url: string;
      prompt: string;
      addToCanvas?: boolean; // default true
      openEditor?: boolean; // default false
    };

let queue: DesignCommand[] = [];
let listener: ((cmd: DesignCommand) => void) | null = null;

/** Send a command to the design screen (queued until it mounts). */
export function sendDesignCommand(cmd: DesignCommand): void {
  if (listener) listener(cmd);
  else queue.push(cmd);
}

/** The design screen registers here on mount; queued commands flush immediately. */
export function registerDesignCommandListener(fn: (cmd: DesignCommand) => void): () => void {
  listener = fn;
  const pending = queue;
  queue = [];
  pending.forEach(fn);
  return () => {
    if (listener === fn) listener = null;
  };
}
