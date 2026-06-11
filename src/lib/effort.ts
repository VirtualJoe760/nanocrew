// Effort tiers control how much detail the AI puts into a generated prompt. Higher tiers
// produce richer, more structured prompts following pro AI-art conventions (civitai): lead
// with the subject, then medium/technique, lighting, composition, colour palette and mood,
// closing with 1-2 FOCUSED quality cues — never generic buzzword soup ("masterpiece, 8k"),
// which dilutes the model's focus.
export type Effort = 1 | 2 | 3 | 4;

export const EFFORT_LABELS: Record<Effort, string> = {
  1: 'Low',
  2: 'Medium',
  3: 'High',
  4: 'Max',
};

export const EFFORT_TIERS: Effort[] = [1, 2, 3, 4];

// Coerce arbitrary input (query string, JSON number) to a valid tier; default Medium.
export function clampEffort(v: unknown): Effort {
  const n = Math.round(Number(v));
  return (n >= 1 && n <= 4 ? n : 2) as Effort;
}

// Guidance appended to the 🎲 random-idea prompt (inventing a fresh concept).
const IDEA: Record<Effort, string> = {
  1: 'Keep it minimal — just the core subject and one style cue. Under 12 words.',
  2: 'Subject, art style and a colour or mood cue. Under 20 words.',
  3:
    'A vivid, structured concept: subject, art style/medium, lighting and a colour palette, ' +
    'written for a clean garment graphic. About 25-35 words.',
  4:
    'A richly detailed concept that leads with the subject, then medium/technique, an art-style ' +
    'reference, lighting, composition, colour palette and mood — cohesive and print-ready, never ' +
    'a list of buzzwords. About 40-55 words.',
};

// Guidance appended to the ✨ enhance prompt (expanding the user's own text).
const ENHANCE: Record<Effort, string> = {
  1: 'Lightly refine — keep it terse, add just one art-style and one quality cue. Under 20 words.',
  2: 'Expand moderately: subject, art style, mood and lighting. About 30-40 words.',
  3:
    'Expand richly and in order — subject first, then medium, lighting, composition, colour ' +
    'palette and mood, ending with 1-2 focused quality cues (e.g. "intricate details, sharp ' +
    'focus"). About 50-60 words.',
  4:
    'Expand into a fully-realised, professional prompt structured like top AI-art prompts: lead ' +
    'with the subject, then medium/technique, an art-style reference, lighting, composition/' +
    'framing, colour palette, texture and mood, ending with 1-2 focused quality cues. Every phrase ' +
    'must add real visual information — no generic buzzword stuffing. About 70-90 words.',
};

export const ideaGuidance = (e: Effort): string => IDEA[e];
export const enhanceGuidance = (e: Effort): string => ENHANCE[e];
