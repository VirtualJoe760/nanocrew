import { EVE_JOBS, EVE_PARTS, EVE_PERSONA_HASH, type EveJob } from '@/eve/persona.generated';

// THE COMPOSER — assembles her agent files into the ONE string the Live API takes as
// `systemInstruction`. Three rules govern this file:
//
//   1. ORDER. Google's Live API guidance for voice agents: persona → conversational rules →
//      guardrails, in that order. Runtime context sits between the rules and the guardrails.
//   2. BUDGET. The same guidance warns against multi-page instructions; markdown makes bloat easy,
//      so an over-budget persona throws in dev instead of quietly degrading her.
//   3. IT IS READ ONCE, AT CONNECT. Editing a file mid-session changes nothing — the socket has to
//      reconnect (see src/eve/README.md).

export { EVE_PERSONA_HASH };

/** Above this the model starts losing the middle of its own instructions. */
const BUDGET = 12_000;

export type PersonaContext = {
  /** Their first name, if we know it. */
  userName?: string;
  /** Brand names they already have — "" for a first-timer. */
  brands?: string[];
  /** Where their site stands, in her words ("live", "building", "not started"). */
  siteStatus?: string;
  /** Opener memory + situational context (lib/eve-openers) — keeps her greetings varied. */
  variation?: string;
  /** Mode-specific reference material generated elsewhere — e.g. the site vocabulary that lets her
   *  name the part of a page someone just circled (lib/site-vocabulary). */
  reference?: string;
};

/** Which job files a mode carries. One agent, several modes — not several agents. */
const MODE_JOBS: Record<string, EveJob[]> = {
  interview: ['brand'],
  central: ['design', 'assets', 'status'],
  critique: ['critique'],
};

export type PersonaMode = keyof typeof MODE_JOBS;

function rightNow(ctx: PersonaContext): string {
  const bits: string[] = [];
  if (ctx.userName?.trim()) bits.push(`You're talking to ${ctx.userName.trim()}.`);
  if (ctx.brands?.length) bits.push(`Their brands: ${ctx.brands.join(', ')}.`);
  else bits.push('They have no brands yet — this is their first.');
  if (ctx.siteStatus?.trim()) bits.push(`Their site: ${ctx.siteStatus.trim()}.`);
  if (ctx.variation?.trim()) bits.push(ctx.variation.trim());
  return bits.join(' ');
}

/**
 * Build the system instruction for one mode.
 * The section headers are load-bearing: they're what lets the model tell identity from rules from
 * refusals when it's performing all three at once.
 */
export function buildPersona(mode: PersonaMode, ctx: PersonaContext = {}): string {
  const jobs = (MODE_JOBS[mode] ?? []).map((j) => `## Your job right now\n\n${EVE_JOBS[j]}`).join('\n\n');
  const instruction = [
    `# Who you are\n\n${EVE_PARTS.identity}`,
    `## How you sound\n\n${EVE_PARTS.soul}`,
    `## How a conversation goes\n\n${EVE_PARTS.conversation}`,
    `## Who you're working for\n\n${EVE_PARTS.user}`,
    jobs,
    ctx.reference?.trim() ? `## Reference\n\n${ctx.reference.trim()}` : '',
    `## Right now\n\n${rightNow(ctx)}`,
    `## Guardrails\n\n${EVE_PARTS.guardrails}`,
    'You are speaking OUT LOUD in real time. No lists, no markdown, no reading JSON, field names or hex codes aloud.',
  ]
    .filter(Boolean)
    .join('\n\n');

  if (__DEV__ && instruction.length > BUDGET) {
    console.warn(`[eve] persona over budget: ${instruction.length} > ${BUDGET} chars — trim src/eve/*.md`);
  }
  return instruction;
}

/** Cheap, dependency-free content hash — logged next to the file hash at setup so "what the model
 *  actually received" is provable, not assumed (djb2; we're detecting drift, not securing it). */
export function personaFingerprint(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}
