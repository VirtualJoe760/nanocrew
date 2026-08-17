import { redirect, permanentRedirect } from 'next/navigation';

// The invite EXPERIENCE moved to the site (nanocrew.app/invite/[token]) on 2026-08-16: user-facing
// pages belong on our own domain, and platform-api is the backend (it still serves the data through
// /api/public/invite/[token] and the accept through /api/public/invite).
//
// This route stays only so invitations already sitting in inboxes keep working — they were sent
// with a nanocrew-api.vercel.app link and must not turn into dead ends.
export const dynamic = 'force-dynamic';

const SITE = (process.env.EMAIL_LINK_BASE ?? 'https://nanocrew.app').replace(/\/+$/, '');

export default async function LegacyInviteRedirect({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  redirect(`${SITE}/invite/${encodeURIComponent(token)}`);
}
