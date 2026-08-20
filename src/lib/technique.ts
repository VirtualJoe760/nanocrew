// One place for what a Printful print TECHNIQUE means for artwork. Not every product is
// screen-printable art: caps are EMBROIDERED (stitched thread), sweaters are KNITWEAR (jacquard
// yarn), all-over products are CUT-SEW / SUBLIMATION panels. Generation (/api/generate), the
// composition-time adaptation (/api/compositions → lib/adapt), and BOTH design surfaces read from
// here, so the constraint story can never drift between the tab and Eve
// (docs/studio/DESIGN_SURFACES.md). Pure data — safe to import from client and server alike.

/** Techniques whose artwork needs generation-time conditioning and composition-time adaptation.
 *  Everything else (DTG, DTFILM, UV, …) prints full-color art as-is. */
export const CONSTRAINED_TECHNIQUES = new Set(['EMBROIDERY', 'KNITWEAR']);

export type TechniqueInfo = {
  /** Short chip label for the product picker. */
  chip: string;
  /** One-line human explanation (picker detail, alerts). */
  human: string;
  /** Constraint sentence appended to the generation prompt (constrained techniques only). */
  artRule?: string;
  /** How Eve mentions it, mid-sentence, when the product is picked (constrained techniques only). */
  spoken?: string;
};

export const TECHNIQUE_INFO: Record<string, TechniqueInfo> = {
  EMBROIDERY: {
    chip: 'Embroidered',
    human: 'Stitched in thread — bold shapes in a few solid colors; gradients and photo detail can’t be stitched.',
    artRule:
      'This artwork will be EMBROIDERED in stitched thread, not printed: use bold, simplified ' +
      'shapes with clean flat fills in at most 6 solid thread colors. No gradients, no ' +
      'photorealistic shading, no fine details or thin lines, no small text — every element ' +
      'must read clearly when stitched.',
    spoken: 'this one is embroidered — stitched in thread — so it wants bold shapes in a few solid colors',
  },
  KNITWEAR: {
    chip: 'Knitted',
    human: 'Knitted from yarn — bold flat shapes in a few colors; fine detail can’t be knitted.',
    artRule:
      'This artwork will be KNITTED from yarn (jacquard), not printed: use only flat solid ' +
      'fills in at most 4 colors, bold simplified shapes, no gradients, no shading, no outlines ' +
      'thinner than a few stitches, no tiny details.',
    spoken: 'this one is knitted from yarn, so it wants bold flat shapes in just a few colors',
  },
  'CUT-SEW': {
    chip: 'All-over print',
    human: 'Printed edge to edge across the whole garment — full-bleed art and patterns shine here.',
  },
  SUBLIMATION: {
    chip: 'All-over print',
    human: 'Dye-printed edge to edge — full-bleed art and patterns shine here.',
  },
  'DIRECT-TO-FABRIC': {
    chip: 'All-over print',
    human: 'Printed straight onto the fabric, edge to edge — full-bleed art and patterns shine here.',
  },
};

/** Info for a technique key, or null when unknown / unconstrained-and-unlabelled. */
export function techniqueInfo(key: string | null | undefined): TechniqueInfo | null {
  return key ? (TECHNIQUE_INFO[key] ?? null) : null;
}
