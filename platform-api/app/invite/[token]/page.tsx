// The collaboration-invite email lands here (lib/notify.ts sendCollabInvite →
// {PLATFORM_API_BASE}/invite/[token]).
//
// Lives on platform-api next to billing/success and connect/return, NOT on the marketing site:
// every email-facing landing page sits on the one web host, which serves iOS, Android and web the
// same way (and this one needs DB access to resolve the token).
//
// DEVICE-AWARE (Joe, 2026-08-16 — the email rule: phones route into the app, laptops route
// through the web). On a phone the pending state deep-links nanocrew:// as before; on a desktop
// that link is a dead click, so the page renders a sign-in / create-account form instead and the
// acceptance is written on the web (POST /api/public/invite, same email-match rules as the app).
// Possession of the link alone still never grants store access.

import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';

import { db, schema } from '@/lib/db';

import { WebAccept } from './web-accept';

export const metadata = { title: 'Brand invitation — Nano Crew' };

// The invite's status flips server-side (accepted / revoked / expired) — never serve a cached verdict.
export const dynamic = 'force-dynamic';

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  // Server-side UA sniff: phones get the app path, everything else the web path. Coarse on
  // purpose — a tablet misread as desktop still lands on a working sign-in form.
  const ua = (await headers()).get('user-agent') ?? '';
  const isPhone = /iPhone|iPad|iPod|Android/i.test(ua);

  const [invite] = await db
    .select({
      status: schema.storeInvites.status,
      expiresAt: schema.storeInvites.expiresAt,
      storeId: schema.storeInvites.storeId,
      invitedBy: schema.storeInvites.invitedBy,
      email: schema.storeInvites.email,
    })
    .from(schema.storeInvites)
    .where(eq(schema.storeInvites.token, token))
    .limit(1);

  let view: {
    glyph: string;
    headline: string;
    sub: string;
    btn?: { label: string; href: string };
    fine?: string;
    web?: React.ReactNode; // the desktop sign-in/accept form (pending state only)
  };

  if (!invite) {
    // Deliberately generic — a guessed token learns nothing about which invites exist.
    view = {
      glyph: '?',
      headline: 'Invite not found',
      sub: 'This link doesn’t match any invitation. Double-check the link from your email, or ask the brand owner to send a new one.',
    };
  } else if (invite.status === 'accepted') {
    view = {
      glyph: '✓',
      headline: 'Already accepted',
      sub: 'This invitation has already been accepted — everything happens in the app from here.',
      btn: { label: 'Open Nano Crew', href: 'nanocrew://account' },
    };
  } else if (invite.status !== 'pending' || invite.expiresAt < new Date()) {
    // Revoked, declined, or past the 14-day window — expired invites are re-sendable by the owner.
    view = {
      glyph: '✕',
      headline: 'This invite is no longer active',
      sub: 'It may have expired or been revoked. Ask the brand owner to send a new one.',
    };
  } else {
    // Pending + unexpired: names load only on this path — the other states don't need them.
    const [store] = await db
      .select({ name: schema.stores.name })
      .from(schema.stores)
      .where(eq(schema.stores.id, invite.storeId))
      .limit(1);
    const [inviter] = await db
      .select({ name: schema.creators.name })
      .from(schema.creators)
      .where(eq(schema.creators.id, invite.invitedBy))
      .limit(1);
    const storeName = store?.name ?? 'a Nano Crew brand';
    view = {
      glyph: '✉',
      headline: `You’re invited to ${storeName}`,
      sub: `${inviter?.name ?? 'The owner'} asked you to collaborate — design and manage the brand together.`,
      ...(isPhone
        ? {
            btn: { label: 'Open in Nano Crew', href: `nanocrew://account?invite=${encodeURIComponent(token)}` },
            fine: 'No app yet? Sign up with this email address and the invite will be waiting in your Account tab.',
          }
        : {
            web: (
              <WebAccept
                token={token}
                invitedEmail={invite.email}
                storeName={storeName}
                supabaseUrl={process.env.SUPABASE_URL ?? ''}
                supabaseKey={process.env.SUPABASE_PUBLISHABLE_KEY ?? ''}
              />
            ),
          }),
    };
  }

  return (
    <main style={styles.page}>
      <div style={styles.card}>
        <div style={styles.check}>{view.glyph}</div>
        <h1 style={styles.h1}>{view.headline}</h1>
        <p style={styles.p}>{view.sub}</p>
        {view.btn ? (
          <a href={view.btn.href} style={styles.btn}>{view.btn.label}</a>
        ) : null}
        {view.web ?? null}
        {view.fine ? <p style={styles.fine}>{view.fine}</p> : null}
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { background: '#08080a', color: '#e7e9ee', minHeight: '100vh', margin: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' },
  card: { maxWidth: 420, width: '100%', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 },
  check: { width: 64, height: 64, borderRadius: 32, border: '1.5px solid #cdd1d9', color: '#cdd1d9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30, marginBottom: 6 },
  h1: { fontSize: 26, fontWeight: 700, margin: 0, letterSpacing: -0.4 },
  p: { fontSize: 15.5, lineHeight: 1.6, color: '#c7cbd3', margin: 0 },
  btn: { marginTop: 10, background: '#cdd1d9', color: '#08080a', textDecoration: 'none', fontWeight: 700, borderRadius: 999, padding: '14px 28px', fontSize: 15 },
  fine: { fontSize: 13, color: '#8b909b', marginTop: 4 },
};
