import type { ReactNode } from 'react';

// The invite flow is a PRODUCT surface, not marketing — so it opts out of the site's paper/gold
// chrome and wears the app's language instead (Joe, 2026-08-16: "it should look more like eve and
// our app"). Eve's ink ground, her teal network accent, platinum CTAs. Scoped to this route only.
export default function InviteLayout({ children }: { children: ReactNode }) {
  return <div className="eve-scope">{children}</div>;
}
