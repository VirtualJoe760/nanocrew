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

// Policy: creators own their designs. Nudity, seductive/edgy imagery, weapons, and action scenes
// all generate fine — we block ONLY genuinely pornographic content and HIGH-severity graphic gore
// (a real-feeling person being killed/mutilated, not action-hero imagery). BLOCK_ONLY_HIGH lets
// Google block just the extreme tail; everything short of that passes. (Google still enforces its
// own non-negotiable floor server-side regardless — incl. CSAM.)
// NOTE: only the standard HARM_CATEGORY_* values are accepted by gemini-2.5-flash-image. The
// HARM_CATEGORY_IMAGE_* variants exist in the enum but the image endpoint rejects them with a 400
// ("Invalid value at safety_settings[].category"), which silently failed EVERY image generation —
// do not re-add them. (Found 2026-06-20 via the editPlan error trace.)
export const IMAGE_SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
];

// We are NOT a general content moderator — creators own their designs. Nudity, seductive/edgy
// looks, weapons, and action scenes are all FINE. We pre-block only two things: (1) genuinely
// PORNOGRAPHIC prompts (explicit sex acts / porn — NOT nudity or "seductive"), and (2) HIGH-severity
// graphic GORE (a person being killed/mutilated — NOT action-hero imagery like "guns + cigar like
// Terminator"). Patterns are tight to avoid false positives on legit fashion ("killer fit", "blood
// orange", "guns out", "skull graphic", "knockout dress").
const SEXUAL = [
  /\b(porn|pornographic|pornhub|xxx|hardcore\s*porn|hentai|rule\s?34)\b/i,
  /\b(blowjob|cumshot|cum\s*shot|handjob|fellatio|cunnilingus|deepthroat|gangbang|creampie)\b/i,
  /\b(sex\s+(act|scene|position)|having\s+sex|penetrat(e|ed|ion)|intercourse)\b/i,
  /\b(explicit\s+(sex|sexual)|sexually\s+explicit|graphic\s+sex)\b/i,
];

const VIOLENCE_GORE = [
  /\b(gore|gory|gruesome)\b/i,
  /\b(dismember(ed|ment)?|decapitat(e|ed|ion)|disembowel(ed|ment)?|mutilat(e|ed|ion))\b/i,
  /\b(beheading|beheaded|severed\s+(head|limb|hand|arm|leg)|entrails|viscera)\b/i,
  /\b(head|skull|brains)\s+(blown|shot|exploded|splattered|caved\s*in)/i,
  /\bblown\s+(off|apart|to\s+(bits|pieces|smithereens))\b/i,
  /\b(graphic\s+(violence|gore|death|injury))\b/i,
  /\b(torture|torturing|tortured)\b/i,
  /\b(brutal(ly)?\s+(murder|kill|slaughter)|massacre|carnage|bloodbath)\b/i,
];

// CSAM — the ONE category that is NEVER a policy choice. Any sexual/nude context involving a minor
// is hard-blocked here (Google blocks it server-side too). This is not moderating creators; it is
// the single thing we will not generate, no matter who asks or how it's framed.
const MINOR = /\b(child|children|kid|kids|minor|underage|toddler|infant|preteen|pre-teen|tween|loli|shota|schoolgirl|schoolboy|([0-9]|1[0-7])\s*(yo|y\/o|years?[\s-]*old))\b/i;
const NUDE_OR_SEXUAL = /\b(nude|nudes|naked|topless|bottomless|lingerie|underwear|panties|thong|sexual|sexy|seductive|erotic|provocative|suggestive|fondl|aroused)\b/i;

/**
 * Throw a ContentSafetyError (HTTP 422) only for the narrow prohibited set: sexual content
 * involving minors (CSAM — always), genuinely pornographic prompts, or HIGH-severity graphic gore.
 * Nudity, seductive/edgy, weapons, and action imagery are allowed (creators own their designs).
 * Call this BEFORE charging credits or invoking the model. No-op for empty prompts.
 */
export function assertSafePrompt(prompt: string | undefined | null): void {
  if (!prompt) return;
  const text = prompt.normalize('NFKC');
  // (1) CSAM — never a policy choice. A minor + any sexual/nude context is hard-blocked.
  if (MINOR.test(text) && NUDE_OR_SEXUAL.test(text)) {
    throw new ContentSafetyError('That request can’t be generated.');
  }
  // (2) Genuinely pornographic — explicit sex acts / porn (NOT nudity or "seductive").
  if (SEXUAL.some((re) => re.test(text))) {
    throw new ContentSafetyError(
      'We only block out-and-out pornographic content (explicit sex acts). Nudity and edgy designs are fine — reword it and you’re good to go.',
    );
  }
  // (3) HIGH-severity graphic gore — a person being killed/mutilated (NOT stylized action/weapons).
  if (VIOLENCE_GORE.some((re) => re.test(text))) {
    throw new ContentSafetyError(
      'We can’t generate graphic gore (a person being killed or mutilated). Stylized action, weapons, and tough imagery are fine — reword it.',
    );
  }
}
