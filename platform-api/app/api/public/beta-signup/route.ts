import { and, count, eq, sql as raw } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { sendBetaApproved, sendBetaSignupAlert, sendBetaWaitlisted } from '@/lib/notify';
import { addTestFlightTester, testflightConfigured } from '@/lib/testflight';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// BETA SIGNUP — the public door on nanocrew.app.
//
// It lives here rather than on the site because nanocrew-site holds NO database credential (see
// AGENTS.md): the site posts here over HTTP, exactly as it does for the catalogue. Before this
// route existed, nanocrew-site's own /api/waitlist quietly no-op'd for the same reason — signups
// were logged to a Vercel function log and nowhere else, so nobody was mailed and nobody was added
// to a beta (Joe, 2026-08-19: "we had someone signup yesterday, but i didnt recieve an email about
// it. nor did they get added to the beta").
//
// Slots are finite, so this is the only place that decides who gets one:
//   under the cap → added to the store's tester list, they get a "you're in", ops gets a heads-up
//   over the cap  → waitlisted, they're told we'll email at launch, ops still gets the heads-up
// A failed store call is recorded as `failed` (never silently "approved"), and the address still
// keeps its place, so ops can retry it by hand without the person having to sign up twice.

/** Build slots per platform. TestFlight external testing and Play closed testing are both capped. */
const CAPS: Record<Platform, number> = { ios: 50, android: 50 };

type Platform = 'ios' | 'android';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cors(origin: string | null): HeadersInit {
  // The site is the only intended caller, but the endpoint is public and idempotent-ish, so keep
  // this permissive rather than shipping a broken form on a preview deployment.
  return {
    'Access-Control-Allow-Origin': origin ?? '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: cors(req.headers.get('origin')) });
}

export async function POST(req: Request) {
  const headers = cors(req.headers.get('origin'));
  let email = '';
  let platform: Platform = 'ios';
  let source: string | undefined;
  try {
    const b = (await req.json()) as { email?: string; platform?: string; source?: string };
    email = (b.email ?? '').trim().toLowerCase();
    platform = b.platform === 'android' ? 'android' : 'ios';
    source = typeof b.source === 'string' ? b.source.slice(0, 80) : undefined;
  } catch {
    return Response.json({ ok: false, error: 'Bad request' }, { status: 400, headers });
  }
  if (!EMAIL_RE.test(email) || email.length > 320) {
    return Response.json({ ok: false, error: 'Enter a valid email.' }, { status: 400, headers });
  }

  try {
    // Already asked for this platform? Tell them where they stand instead of burning a second slot.
    const [existing] = await db
      .select()
      .from(schema.betaSignups)
      .where(and(eq(schema.betaSignups.email, email), eq(schema.betaSignups.platform, platform)))
      .limit(1);
    if (existing && existing.status === 'approved') {
      return Response.json({ ok: true, status: 'approved', repeat: true }, { headers });
    }

    // The cap counts APPROVED rows — the people actually holding a slot.
    const [{ taken }] = await db
      .select({ taken: count() })
      .from(schema.betaSignups)
      .where(and(eq(schema.betaSignups.platform, platform), eq(schema.betaSignups.status, 'approved')));
    const cap = CAPS[platform];
    const room = Math.max(0, cap - Number(taken));

    // Android has no automated tester list yet (no Play service account, and the build needs its own
    // round of testing first), so those signups are collected and mailed at launch. iOS is live.
    const canAutoAdd = platform === 'ios' && testflightConfigured();
    let status: 'approved' | 'waitlisted' | 'failed' = 'waitlisted';
    let errorMsg: string | null = null;

    if (room > 0 && canAutoAdd) {
      const r = await addTestFlightTester(email);
      if (r.ok) {
        status = 'approved';
      } else if (r.skipped) {
        status = 'waitlisted';
      } else {
        status = 'failed';
        errorMsg = r.reason;
      }
    } else if (room > 0 && platform === 'android') {
      // Room, but no automation — this is a slot we intend to honour, by hand.
      errorMsg = 'android tester list is manual for now';
    }

    const row = {
      email,
      platform,
      status,
      errorMsg,
      invitedAt: status === 'approved' ? new Date() : null,
      source: source ?? 'nanocrew.app',
    };
    await db
      .insert(schema.betaSignups)
      .values(row)
      .onConflictDoUpdate({
        target: [schema.betaSignups.email, schema.betaSignups.platform],
        // Never downgrade someone who already holds a slot.
        set: {
          status: raw`case when ${schema.betaSignups.status} = 'approved' then ${schema.betaSignups.status} else excluded.status end`,
          errorMsg: raw`excluded.error_msg`,
          invitedAt: raw`coalesce(${schema.betaSignups.invitedAt}, excluded.invited_at)`,
        },
      });

    const remaining = Math.max(0, room - (status === 'approved' ? 1 : 0));
    // Emails are best-effort by design (lib/notify never throws) — a mail outage must not cost
    // someone their place in the beta.
    await Promise.all([
      sendBetaSignupAlert({ email, platform, status, remaining, note: errorMsg ?? undefined }),
      status === 'approved' ? sendBetaApproved({ to: email, platform }) : sendBetaWaitlisted({ to: email, platform }),
    ]);

    return Response.json({ ok: true, status, remaining }, { headers });
  } catch (e) {
    console.error('[beta-signup]', e instanceof Error ? e.message : e);
    return Response.json({ ok: false, error: 'Could not save — try again.' }, { status: 500, headers });
  }
}
