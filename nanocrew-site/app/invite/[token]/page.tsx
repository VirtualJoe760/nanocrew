import { headers } from 'next/headers';

import { API_BASE } from '@/lib/store';

import './eve.css';
import { EveGlyph, Starfield } from './eve-glyph';
import { WebAccept } from './web-accept';

// nanocrew.app/invite/[token] — the collaboration-invite landing page.
//
// It lives HERE, on the site, not on platform-api: the site is the user-facing web surface and the
// API is the backend (Joe, 2026-08-16 — "the URL should go through nanocrew.app"). Following the
// site's existing contract (lib/store.ts), this page holds no database credential; it resolves the
// token over plain HTTP from the public API, exactly like the storefront reads the catalogue.
//
// Device-aware: a phone gets the app deep link (the app is the priority surface for our emails);
// a laptop, where nanocrew:// is a dead click, gets sign-in / create-account right here.

export const metadata = { title: 'Brand invitation — Nano Crew' };
export const dynamic = 'force-dynamic'; // the invite's status flips server-side

type InviteSummary =
  | { state: 'not_found' | 'inactive' | 'accepted' }
  | { state: 'pending'; storeName: string; storeSlug: string | null; inviterName: string; emailHint: string };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // Coarse on purpose: a tablet misread as desktop still lands on a working sign-in form.
  const ua = (await headers()).get('user-agent') ?? '';
  const isPhone = /iPhone|iPad|iPod|Android/i.test(ua);

  let invite: InviteSummary = { state: 'not_found' };
  try {
    const res = await fetch(`${API_BASE}/api/public/invite/${encodeURIComponent(token)}`, { cache: 'no-store' });
    if (res.ok) invite = (await res.json()) as InviteSummary;
  } catch {
    // API unreachable — fall through to the generic state rather than a Next error page.
  }

  return (
    <main className="eve-page">
      <Starfield />
      <div className="eve-card">
        <EveGlyph />
        <p className="eve-eyebrow">NANO CREW · COLLABORATION</p>
        {invite.state === 'pending' ? (
          <>
            <h1 className="eve-h1">You&rsquo;re invited to {invite.storeName}</h1>
            <p className="eve-p">
              {invite.inviterName} asked you to collaborate — design and manage the brand together.
            </p>
            {isPhone ? (
              <>
                <a className="eve-cta" href={`nanocrew://account?invite=${encodeURIComponent(token)}`}>
                  Open in Nano Crew
                </a>
                <p className="eve-fine">
                  No app yet? Sign up with this email address and the invite will be waiting in your
                  Account tab.
                </p>
              </>
            ) : (
              <WebAccept token={token} emailHint={invite.emailHint} storeName={invite.storeName} />
            )}
          </>
        ) : invite.state === 'accepted' ? (
          <>
            <h1 className="eve-h1">Already accepted</h1>
            <p className="eve-p">
              This invitation has already been accepted — the brand is in your Account.
            </p>
          </>
        ) : invite.state === 'inactive' ? (
          <>
            <h1 className="eve-h1">This invite is no longer active</h1>
            <p className="eve-p">
              It may have expired or been revoked. Ask the brand owner to send a new one.
            </p>
          </>
        ) : (
          <>
            <h1 className="eve-h1">Invite not found</h1>
            <p className="eve-p">
              This link doesn&rsquo;t match any invitation. Double-check the link from your email, or
              ask the brand owner to send a new one.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
