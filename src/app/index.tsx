import { Redirect } from 'expo-router';

// The social feed lives at /feed but is HIDDEN for v1 — Nano Crew launches focused on building
// brand websites + product designs, so the app lands on Studio (the creator's home). The feed
// code is preserved (src/app/feed.tsx, no tab) and returns as a tab in v2; nothing was deleted.
export default function Index() {
  return <Redirect href="/studio" />;
}
