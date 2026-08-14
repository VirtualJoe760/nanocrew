// EVE'S OPENING CONTEXT — her steady-state greeting from the creator's world (docs/studio/
// EVE_CENTRAL.md / EVE_CONTROL.md). Pure and cheap: eve-home feeds it /api/me data and shows the
// greeting as her opening subtitle (and, later, as the seed of her spoken opening).
//
// The next-best-action SUGGESTIONS this used to compute are gone — the capability registry + orbs
// that replaced them were themselves retired (83a6873). This file is greeting-only.

export type VenusGuidance = { greeting: string };

type StoreLite = { name: string; slug: string; status: string };

function timeOfDay(d = new Date()): string {
  const h = d.getHours();
  if (h < 5) return 'Evening';
  if (h < 12) return 'Morning';
  if (h < 18) return 'Afternoon';
  return 'Evening';
}

export function venusGuide(opts: { firstName?: string; stores: StoreLite[] }): VenusGuidance {
  const { firstName, stores } = opts;
  const hi = firstName ? `${timeOfDay()}, ${firstName}.` : `${timeOfDay()}.`;
  const live = stores.filter((s) => s.status === 'live');
  const unfinished = stores.find((s) => s.status !== 'live' && s.status !== 'suspended');

  let situation: string;
  if (!stores.length) {
    situation = "Shall we build your brand? Just start talking — I'll capture everything.";
  } else if (unfinished) {
    situation = `“${unfinished.name}” isn't live yet — shall we finalize the website?`;
  } else if (live.length) {
    situation = `“${live[0].name}” is live. Want your digest, or shall we make something?`;
  } else {
    situation = 'What shall we make today?';
  }

  return { greeting: `${hi} ${situation}` };
}
