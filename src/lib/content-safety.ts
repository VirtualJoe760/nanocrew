import { HarmBlockThreshold, HarmCategory } from '@google/genai';

// Content safety for AI generation. Two layers:
//   1. assertSafePrompt() — a cheap server-side pre-check that rejects sexual-explicit and
//      graphic-violence/gore prompts BEFORE we spend credits or hit the model.
//   2. IMAGE_SAFETY_SETTINGS — Gemini safetySettings spread into every image generateContent
//      config so the model itself blocks the same two categories (defense in depth).
//
// Policy (per Terms §5): the only hard-prohibited generation categories are sexual content and
// graphic violence/gore — things we will not print on a garment. This is deliberately narrow;
// we are not a general content moderator, just keeping the print pipeline clean and lawful.

export class ContentSafetyError extends Error {
  status = 422;
  constructor(message: string) {
    super(message);
    this.name = 'ContentSafetyError';
  }
}

// Block sexual-explicit + dangerous (violence/gore) on both the text and image harm axes.
// BLOCK_MEDIUM_AND_ABOVE: catch clear cases without nuking borderline edgy-but-fine fashion art.
export const IMAGE_SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_IMAGE_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_IMAGE_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];

// Word-boundary patterns for the two prohibited buckets. Kept intentionally tight to avoid false
// positives on legitimate fashion language ("cut", "blood orange", "killer fit", "skull graphic").
const SEXUAL = [
  /\b(porn|pornographic|nsfw|xxx|hardcore)\b/i,
  /\b(nude|nudes|naked|topless|bottomless)\b/i,
  /\b(explicit\s+(sex|sexual|nudity))\b/i,
  /\b(sexual(ly)?\s+explicit)\b/i,
  /\bgenital(s|ia)?\b/i,
  /\b(penis|vagina|vulva|nipples?|areola|labia|cum|cumshot|blowjob|handjob|fellatio|cunnilingus)\b/i,
  /\b(erotic|erotica|fetish|bdsm|hentai|rule\s?34)\b/i,
  /\b(sex\s+(act|scene|position)|having\s+sex|making\s+love)\b/i,
];

const VIOLENCE_GORE = [
  /\b(gore|gory|gruesome)\b/i,
  /\b(dismember(ed|ment)?|decapitat(e|ed|ion)|disembowel(ed|ment)?|mutilat(e|ed|ion))\b/i,
  /\b(beheading|beheaded)\b/i,
  /\b(blood(y)?\s+(corpse|body|wound|gash|massacre|carnage))\b/i,
  /\b(graphic\s+(violence|gore|death|injury))\b/i,
  /\b(torture|torturing|tortured)\b/i,
  /\b(severed\s+(head|limb|hand|arm|leg)|entrails|viscera)\b/i,
  /\b(brutal(ly)?\s+(murder|kill|slaughter)|massacre|carnage)\b/i,
];

/**
 * Throw a ContentSafetyError (HTTP 422) if a creator's free-text prompt asks for sexual content
 * or graphic violence/gore. Call this BEFORE charging credits or invoking the model. No-op for
 * empty/undefined prompts (image-only edits have no prompt to screen).
 */
export function assertSafePrompt(prompt: string | undefined | null): void {
  if (!prompt) return;
  const text = prompt.normalize('NFKC');
  if (SEXUAL.some((re) => re.test(text))) {
    throw new ContentSafetyError(
      "We can't generate sexual or explicit content. Try a different design — Nano Crew is for things we can print and sell.",
    );
  }
  if (VIOLENCE_GORE.some((re) => re.test(text))) {
    throw new ContentSafetyError(
      "We can't generate graphic violence or gore. Try a different design — Nano Crew is for things we can print and sell.",
    );
  }
}
