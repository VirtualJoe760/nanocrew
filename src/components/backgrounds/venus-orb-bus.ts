// Tiny THREE-free bus for the orb's SHAPE-MORPH requests. Anything in the app (the Lab's shape
// chips today; Studio keyword-spotting on Venus's live transcript tomorrow) calls
// setVenusOrbShape('tee') and the mounted orb scene dissolves its dots and re-forms them as that
// object, then returns to 'orb' when asked. Kept free of three imports so UI modules (statically
// bundled on native) can import it without dragging the 3D stack into the bundle.

export type VenusOrbShape = 'orb' | 'tee' | 'heart' | 'bolt';

let current: { shape: VenusOrbShape; seq: number } = { shape: 'orb', seq: 0 };

/** Ask the mounted orb to re-form its dots as `shape` ('orb' returns to the sphere). */
export function setVenusOrbShape(shape: VenusOrbShape): void {
  current = { shape, seq: current.seq + 1 };
}

/** Polled by the orb scene each frame. */
export function getVenusOrbShapeRequest(): { shape: VenusOrbShape; seq: number } {
  return current;
}
