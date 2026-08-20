// The Studio brand-interview brain. The live interview now runs on Gemini Live (lib/live-voice.ts);
// this module's `interviewSystem`/`parseTurn` are reused by /api/extract-brand to turn the spoken
// transcript into a final brand profile + design system that the storefront templates consume
// (template + brand tokens, not generated-from-scratch). `ChatMessage`/`BrandResult` are the shared
// types across the live session, extract-brand, and store provisioning.

import { buildPersona } from '@/lib/eve-persona';

export type ChatMessage = { role: 'user' | 'assistant'; text: string };

/** A spoken word with its start time (seconds) in the generated audio. */
export type TimedWord = { w: string; t: number };

export type BrandResult = {
  name: string;
  tagline: string;
  mission: string;
  audience: string;
  voice: string;
  story: string;
  vibeKeywords: string[];
  logo: { exists: boolean; direction: string };
  designStyle: 'minimalist' | 'bold' | 'elegant' | 'extravagant' | 'street';
  products: string[];
  /** Website look/layout wishes in the creator's own words ("slideshow at the top",
   *  "mobile bottom bar") — Eve translates these to concrete blocks (via the template's
   *  VOCABULARY.md) when she authors the build brief; see authorBrandBrief in lib/provision.ts. */
  siteNotes?: string[];
  designSystem: {
    palette: { role: string; hex: string }[];
    typography: { display: string; body: string };
    texture: string[];
    motion: string[];
  };
};

export type InterviewTurn = {
  userText?: string;
  done: boolean;
  question?: string;
  brand?: BrandResult;
};

export function interviewSystem(userName?: string, aiName = 'Eve'): string {
  const first = userName?.trim().split(/\s+/)[0];
  // ONE PERSONA, NOT THREE (EVE_VOICE.md; BUG_AUDIT_2026-08-20 #26). This is the EXTRACTION leg —
  // it reads a finished transcript and emits the brand JSON, it never speaks — so it takes her
  // character from the SAME source as the spoken personas (src/eve/*.md via buildPersona) and adds
  // only what extraction needs: the derivation method and the output contract. It used to carry a
  // hand-written copy of her register (a pre-2026-08-17 "talk to a mate" voice, an 18-word cap and
  // the banned-phrasings blacklist), which drifted twice while the .md files moved on — so the
  // extractor was modelling a different Eve than the one who spoke the transcript it was reading.
  const character = buildPersona('interview', { userName: first });
  return `${character}

---

YOUR TASK RIGHT NOW IS EXTRACTION, NOT CONVERSATION. You are reading a finished conversation and
producing the brand that falls out of it. ${first ? `The creator's name is ${first}. ` : ''}You are ${aiName}.

DERIVE, DON'T INVENT — and never override an explicit choice. If they said "black and white", the
palette is exactly black, white and neutral greys. Their words win for names, fonts and styles; you
fill only the gaps they left. Design temperament, palette, typography, texture and motion are
DERIVED from the why and the way they talk, unless they volunteered them. Any website wish said in
passing ("a slideshow up top", "video behind the logo") is kept VERBATIM in siteNotes.

What the brand needs to carry: their name for it, their why in their own words (mission + story),
who it's for and how they talk, what they're selling first, and whether a logo exists or what it
should be.

ALWAYS reply with ONLY a JSON object, no markdown fences, in one of these two shapes:
  {"userText": "<verbatim transcript of what the user just said, if audio was provided>",
   "done": false, "question": "<your next single question, written as natural speech>"}
or
  {"userText": "<transcript if audio was provided>", "done": true,
   "closing": "<one short spoken line wrapping up, telling them their brand is ready>",
   "brand": {
    "name": "<brand name>",
    "tagline": "<short tagline>",
    "mission": "<1-2 sentence mission>",
    "audience": "<who it's for>",
    "voice": "<brand voice/personality>",
    "story": "<short brand story/lore paragraph>",
    "vibeKeywords": ["<3-6 keywords>"],
    "logo": {"exists": <true if they already have one>, "direction": "<what it looks like or should look like>"},
    "designStyle": "<minimalist|bold|elegant|extravagant|street — their stated preference; 'street' = bold full-bleed streetwear/skate>",
    "products": ["<the products they're excited to sell>"],
    "siteNotes": ["<any website look/layout wishes, kept VERBATIM in their own words — e.g. 'a slideshow of photos at the top', 'a video playing behind the logo', 'buttons at the bottom on phones'. Empty array if none came up>"],
    "designSystem": {
      "palette": [{"role": "primary|secondary|accent|background|text", "hex": "#RRGGBB"}],
      "typography": {"display": "<display font style, honoring their preference>", "body": "<body font style>"},
      "texture": ["<2-4 texture/material cues>"],
      "motion": ["<2-3 motion-language cues>"]
    }
  }}
The palette must have exactly 5 entries (primary, secondary, accent, background, text) that
honor their stated colors exactly. If the user's audio is unclear or empty, set userText to
"" and ask them to say it again.`;
}

/** Parse + sanity-check the model's JSON reply. Throws on malformed output. */
export function parseTurn(raw: string): InterviewTurn & { closing?: string } {
  const parsed = JSON.parse(raw) as InterviewTurn & { closing?: string };
  if (!parsed.done && !parsed.question) throw new Error('malformed interview turn');
  if (parsed.done && !parsed.brand?.name) throw new Error('malformed brand');
  return parsed;
}
