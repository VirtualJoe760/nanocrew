// VENUS'S GUIDANCE BRAIN — computes her steady-state greeting + next-best-action tools from the
// creator's world (docs/studio/VENUS_CENTRAL.md: "she talks to the user, and guides them on what
// to do next — build your brand, finalize your website, create new designs, memes…").
//
// Pure and cheap: the Venus Sheet feeds it /api/me data and renders the result. When the
// conversational lanes land (chat/voice), this same output becomes her opening context.

export type VenusToolKey = 'build-brand' | 'edit-site' | 'create-designs' | 'make-meme' | 'blog-post';

export type VenusSuggestion = {
  key: VenusToolKey;
  label: string;
  detail: string;
};

export type VenusGuidance = {
  greeting: string;
  suggestions: VenusSuggestion[];
};

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

  const suggestions: VenusSuggestion[] = [];
  let situation: string;

  if (!stores.length) {
    situation = "Shall we build your brand? Just start talking — I'll capture everything.";
    suggestions.push({
      key: 'build-brand',
      label: 'Build your brand',
      detail: 'A conversation — name, products, style. I do the rest.',
    });
  } else if (unfinished) {
    situation = `“${unfinished.name}” isn't live yet — shall we finalize the website?`;
    suggestions.push({
      key: 'edit-site',
      label: 'Finalize your website',
      detail: `Get “${unfinished.name}” polished and live.`,
    });
  } else if (live.length) {
    const s = live[0];
    situation = `“${s.name}” is live. What shall we make today?`;
    suggestions.push({
      key: 'edit-site',
      label: 'Edit your site',
      detail: 'Circle anything on the page and tell me what to change.',
    });
  } else {
    situation = 'What shall we make today?';
  }

  suggestions.push(
    {
      key: 'create-designs',
      label: 'Create new designs',
      detail: 'Fresh graphics for your next drop.',
    },
    {
      key: 'make-meme',
      label: 'Make a meme',
      detail: 'Social-ready — your brand, internet-native.',
    },
  );
  if (stores.length) {
    suggestions.push({
      key: 'blog-post',
      label: 'Write a blog post',
      detail: 'A post for your site — scheduling lands soon.',
    });
  }

  // If a second store exists in another state, she still leads with ONE clear next step —
  // guidance is a suggestion, never a wall of options (max 4 chips).
  return { greeting: `${hi} ${situation}`, suggestions: suggestions.slice(0, 4) };
}
