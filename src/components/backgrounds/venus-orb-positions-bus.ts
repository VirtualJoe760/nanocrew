// Tiny THREE-free bus for Eve's CAPABILITY ORBS — the reverse of venus-orb-bus (which is RN→scene).
// This is SCENE→RN: the orb scene projects each 3D capability-orb's world position to a 2D screen
// coordinate every frame and pushes it here; the RN hitbox layer (eve-orb-field) reads it and parks
// invisible Pressables over each orb. That's how a 3D object in the GL scene becomes reliably
// tappable on expo-gl (which has no working R3F pointer picking). RN→scene also carries the COUNT
// (how many orbs to show), so the scene renders exactly the visible capability nodes.
//
// THREE-free on purpose (like venus-orb-bus / venus-speech-level) so the RN overlay imports it
// without dragging the 3D stack into the statically-bundled UI. Kept off React state — polled.

// nx/ny are NORMALIZED screen coords in [0,1] (0,0 = top-left). The scene can't know the RN window
// size (its GL `size` is the canvas backing store, not RN dp), so it pushes normalized and the RN
// hitbox layer multiplies by its own useWindowDimensions — decoupling the two coordinate spaces.
export type EveOrbScreenPos = { i: number; nx: number; ny: number; visible: boolean };

let count = 0; // RN → scene: how many capability orbs to render
let positions: EveOrbScreenPos[] = []; // scene → RN: their current screen positions

/** RN tells the scene how many capability orbs to light up (0 = none). */
export function setEveOrbCount(n: number): void {
  count = n;
}
export function getEveOrbCount(): number {
  return count;
}

/** The scene pushes each visible orb's projected screen position each frame. */
export function setEveOrbScreenPositions(next: EveOrbScreenPos[]): void {
  positions = next;
}
export function getEveOrbScreenPositions(): EveOrbScreenPos[] {
  return positions;
}
