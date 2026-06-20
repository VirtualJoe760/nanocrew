export const meta = {
  name: 'image-gen-architecture-review',
  description: 'Deep-dive the site-edit image-generation architecture and recommend the best approach',
  phases: [
    { title: 'Map', detail: 'parallel readers map the real current implementation across all units' },
    { title: 'Design', detail: 'independent panel weighs architectural options' },
    { title: 'Synthesize', detail: 'one recommendation + plan grounded in the code' },
  ],
}

const MAP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    area: { type: 'string' },
    currentBehavior: { type: 'string', description: 'precisely what happens today, step by step, in this area' },
    keyFiles: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { path: { type: 'string' }, role: { type: 'string' } }, required: ['path', 'role'] } },
    imageCapabilityToday: { type: 'string', description: 'how/where images get generated and placed today as it touches this area; quote the actual mechanism' },
    couldForgeDoItHere: { type: 'string', description: 'whether/how the forge robot (headless Claude on the droplet) could generate and wire images for this area, and what it would need' },
    gaps: { type: 'array', items: { type: 'string' }, description: 'concrete weaknesses, silent failures, or missing pieces found in the CODE (cite file:line)' },
  },
  required: ['area', 'currentBehavior', 'keyFiles', 'imageCapabilityToday', 'couldForgeDoItHere', 'gaps'],
}

const PANEL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    approach: { type: 'string' },
    summary: { type: 'string' },
    mapsToExistingCode: { type: 'string', description: 'how this reuses or changes the actual files in the maps' },
    pros: { type: 'array', items: { type: 'string' } },
    cons: { type: 'array', items: { type: 'string' } },
    reliability: { type: 'string' },
    latency: { type: 'string' },
    cost: { type: 'string' },
    observability: { type: 'string' },
    effort: { type: 'string' },
    risks: { type: 'array', items: { type: 'string' } },
    verdict: { type: 'string', description: 'honest bottom line: when this is the right call, when not' },
  },
  required: ['approach', 'summary', 'mapsToExistingCode', 'pros', 'cons', 'reliability', 'latency', 'cost', 'observability', 'effort', 'verdict'],
}

const REC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    recommendation: { type: 'string', description: 'the single recommended architecture, stated plainly' },
    why: { type: 'string' },
    keptFromCurrent: { type: 'array', items: { type: 'string' }, description: 'what of the current implementation is good and should stay' },
    plan: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { step: { type: 'string' }, detail: { type: 'string' }, files: { type: 'array', items: { type: 'string' } } }, required: ['step', 'detail'] } },
    tradeoffs: { type: 'array', items: { type: 'string' } },
    alternativesRejected: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' }, why: { type: 'string' } }, required: ['name', 'why'] } },
    openQuestions: { type: 'array', items: { type: 'string' }, description: 'genuine decisions only Joe can make' },
  },
  required: ['recommendation', 'why', 'keptFromCurrent', 'plan', 'tradeoffs', 'alternativesRejected'],
}

const repo = '/Users/macdaddyjoe/code/nanocrew'

phase('Map')
const READERS = [
  {
    area: 'Client orchestration (edit + design flows)',
    prompt: 'Map exactly how the MOBILE APP orchestrates image generation today. Read these real files in ' + repo + ': src/components/site-preview.tsx (the critique editor submit() — how it plans, generates, and places images), src/app/design.tsx (the Design tab generate flow), src/hooks/use-live-voice.ts and src/lib/live-voice.ts (the critique/Venus persona around images). Search for any other call sites of /api/generate and /api/creator/site-assets. Report precisely what the CLIENT does step by step, who orchestrates the plan-then-generate-then-place sequence, and the gaps (silent failures, retries, UX). Cite file:line.',
  },
  {
    area: 'Server image routes (generate + place + classify)',
    prompt: 'Map the SERVER side of image generation in ' + repo + '. Read: src/app/api/generate+api.ts (the Gemini/Nano Banana call, Cloudinary upload, credit-gating, content-safety), src/app/api/creator/site-assets+api.ts (how a generated URL is written to stores.site_assets and revalidated), src/app/api/creator/plan-site-edits+api.ts (the transcript-to-{images,edits} classifier), src/lib/transparency.ts, src/lib/content-safety.ts, src/lib/credits.ts, and wherever uploadImage/Cloudinary lives. Report the exact generation mechanism, auth model, what is and is not credit-gated, and how an image reaches a live storefront. Cite file:line.',
  },
  {
    area: 'Forge robot + worker + conditioning',
    prompt: 'Map the FORGE in ' + repo + '. Read: forge-worker/worker.mjs (how the droplet worker drains store_revisions, runs headless Claude, what tools/commands it has, the build/deploy, any silent-fail like || true), forge-worker/forge-CLAUDE.md (the Master CLAUDE.md conditioning the robot), src/lib/revise.ts (how the app enqueues, builds the brief and annotations). Search for how the brief is authored (e.g. authorBrandBrief) and the allowed edit surface. CRITICAL QUESTION: could the forge robot itself generate images via an API call (it is a headless Claude with shell/tools on a droplet)? What would it need (an /api/generate call with a key, an MCP, a script), and what does it have access to today? Cite file:line.',
  },
  {
    area: 'Templates + storefront data contract',
    prompt: 'Map how a generated image actually RENDERS on a brand storefront. In ' + repo + ' read: docs/storefront/STOREFRONT_DATA_CONTRACT.md, docs/storefront/BUILD_QUALITY.md, docs/storefront/STOREFRONT_ENGINE.md. Find how templates read stores.site_assets.hero (getHeroMedia and the public API /api/public/stores/:slug/site-assets, ISR revalidate). The templates live in a SIBLING repo (nanocrew-templates) — say so if you cannot read them and infer the contract from the docs plus the public API route under src/app/api/public/. Report the exact data path from a generated image URL to pixels on the live site, the brand.json token contract, and where the forge vs the direct path each write. Cite file:line.',
  },
  {
    area: 'Docs + roadmap intent',
    prompt: 'Map the INTENDED direction in ' + repo + ' docs. Read: docs/studio/FORGE_AI.md, docs/storefront/BUILD_QUALITY.md, docs/studio/DESIGN_GENERATOR.md, docs/studio/EDIT_PIPELINE.md, docs/README.md. Report what the docs SAY about: (a) why generated sites look like bare templates, (b) the plan to give the forge eyes plus a self-critique loop, (c) the design generator as the real-asset pipeline that replaces placeholders, (d) the direct-vs-forge philosophy (precise deterministic actions go direct; open-ended creative work goes to the forge). Capture this stated architecture faithfully and note any place the code already contradicts the docs. Cite the doc sections.',
  },
]
const maps = (await parallel(READERS.map((r) => () => agent(r.prompt + '\n\nYou are mapping the CURRENT implementation accurately — read the actual files, do not guess. Return structured findings.', { label: 'map:' + r.area.slice(0, 26), phase: 'Map', schema: MAP_SCHEMA })))).filter(Boolean)

const mapsDigest = JSON.stringify(maps, null, 1)
log('Mapped ' + maps.length + ' areas — running the design panel.')

phase('Design')
const APPROACHES = [
  { name: 'A: keep client-orchestrated direct path, harden it', lens: 'Defend and improve the CURRENT design where the client calls plan then generate then site-assets directly and the forge only does code. Argue why direct calls are right for known slots, and how to harden them: retries, error surfacing, optional preview/review for images, idempotency. Be the strongest advocate for NOT moving image generation into the forge.' },
  { name: 'B: forge-as-agent with an image-generation tool', lens: 'Give the forge robot the ability to generate images itself (an /api/generate call or a tool/MCP) so a single revision can both wire the layout AND fill it with real generated imagery, with the planned eyes plus self-critique loop. This aligns with the docs roadmap. Detail exactly what the forge needs and how it would call generation safely: keys, credits, content-safety, and where the resulting URL gets written.' },
  { name: 'C: server-orchestrated atomic edit endpoint', lens: 'Move orchestration OFF the client into a single platform-api or app endpoint that does plan, generate, place, and enqueue-forge atomically and returns one structured result. The client just sends the request plus transcript. Emphasize reliability, observability, and not trusting a mobile client mid-sequence.' },
  { name: 'D: hybrid, direct for known slots and forge-agent for novel imagery', lens: 'Split by request type: deterministic known-slot swaps (hero, logo, og) stay on the fast direct/server path; open-ended or structurally novel image work (new sections, in-context product imagery, multi-image compositions) goes to the forge-as-agent. Define the routing rule precisely.' },
]
const panel = (await parallel(APPROACHES.map((a) => () => agent(
  'You are evaluating ONE architecture for how Nano Crew should generate and place images when a creator edits their live site by talking to Venus. The current code and the docs are summarized here:\n\n' + mapsDigest + '\n\nYour assigned approach:\n' + a.name + '\n' + a.lens + '\n\nGround everything in the ACTUAL files named in the maps. Be rigorous and honest about cost (credit-gating today), latency, reliability, observability, and engineering effort. If your approach is wrong for some cases, say so. You may read files in ' + repo + ' to verify specifics.',
  { label: 'design:' + a.name.slice(0, 16), phase: 'Design', schema: PANEL_SCHEMA },
)))).filter(Boolean)

log('Panel returned ' + panel.length + ' approaches — synthesizing.')

phase('Synthesize')
const rec = await agent(
  'You are the lead architect. Decide the BEST architecture for image generation in Nano Crew live-site edit flow (creator talks to Venus, images get generated and placed). Joe framing: the forge CAN generate images via an API call — he wants to know if the current implementation (client orchestrates plan, generate, site-assets directly; forge only edits code) is the best way, or what could be done better.\n\nCURRENT IMPLEMENTATION AND DOCS MAP:\n' + mapsDigest + '\n\nDESIGN PANEL EVALUATIONS:\n' + JSON.stringify(panel, null, 1) + '\n\nProduce a decisive recommendation grounded in the real files. It must: (1) state the single recommended architecture plainly; (2) say honestly what of the CURRENT implementation is good and should be kept (do not rebuild for its own sake — Joe hates that); (3) give a concrete, ordered plan with the actual files to touch; (4) list tradeoffs and the alternatives rejected and why; (5) surface only genuine decisions Joe must make. Respect the repo direct-vs-forge philosophy and the give-the-forge-eyes roadmap. Be specific, not generic.',
  { label: 'synthesize', phase: 'Synthesize', schema: REC_SCHEMA },
)

return { maps, panel, rec }
