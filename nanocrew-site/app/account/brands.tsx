'use client';

import { useCallback, useEffect, useState } from 'react';

import { apiFetch, appApiFetch } from '@/lib/api';

// "Your brands", "Payouts" and "Brand collaborators" — the web mirror of the app's Account
// sections (src/app/account.tsx). Everything is server-enforced: the collaborator surface only
// appears for brands you OWN, and the API returns 404 to anyone else who asks.

type Store = {
  id: string;
  slug: string;
  name: string;
  status: string;
  role: 'owner' | 'collaborator';
  customDomain: string | null;
};

type Payouts = {
  connected: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  requirementsDue: number;
  disabledReason: string | null;
};

type Member = { id: string; email: string; name: string | null; role: string };
type Invite = { id: string; email: string; expiresAt: string };

export function Brands() {
  const [stores, setStores] = useState<Store[] | null>(null);
  const [payouts, setPayouts] = useState<Payouts | null>(null);
  const [payoutBusy, setPayoutBusy] = useState(false);
  const [payoutError, setPayoutError] = useState<string | null>(null);
  const [openSlug, setOpenSlug] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch('/api/creator/stores');
    if (res.ok) setStores(((await res.json()) as { stores: Store[] }).stores);
    else setStores([]);
    // Payout status comes from the APP's backend, which owns Stripe Connect. A failure here is not
    // fatal to the page — the section simply offers to start setup.
    try {
      const p = await appApiFetch('/api/creator/connect');
      if (p.ok) setPayouts((await p.json()) as Payouts);
    } catch {
      /* offline or blocked — leave payouts unknown */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function openPayouts() {
    setPayoutBusy(true);
    setPayoutError(null);
    try {
      const res = await appApiFetch('/api/creator/connect', { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !body.url) throw new Error(body.error ?? 'Payouts aren’t available yet.');
      // Stripe-hosted onboarding; they come back to the Connect return page.
      window.location.href = body.url;
    } catch (e) {
      setPayoutError(e instanceof Error ? e.message : 'Could not start payout setup.');
      setPayoutBusy(false);
    }
  }

  if (!stores) return <p className="acct-muted">Loading your brands…</p>;

  const ready = !!payouts?.chargesEnabled && !!payouts?.payoutsEnabled;
  const payoutTitle = ready
    ? 'Payouts active'
    : payouts?.chargesEnabled
      ? 'Payouts paused — action needed'
      : payouts?.connected
        ? 'Finish payout setup'
        : 'Set up payouts';
  const payoutSub = ready
    ? 'Your store sales pay out to your account'
    : payouts?.chargesEnabled
      ? payouts.requirementsDue > 0
        ? `Stripe needs ${payouts.requirementsDue} more ${payouts.requirementsDue === 1 ? 'item' : 'items'} to resume payouts`
        : 'Stripe has paused payouts to your bank — open to review'
      : payouts?.connected && payouts.requirementsDue > 0
        ? `Stripe needs ${payouts.requirementsDue} more ${payouts.requirementsDue === 1 ? 'item' : 'items'}`
        : 'Get paid when your brand sells';

  return (
    <>
      <p className="acct-label">Your brands</p>
      <div className="acct-card acct-list">
        {stores.length ? (
          stores.map((s) => (
            <div className="acct-row" key={s.id}>
              <div className="acct-row-meta">
                <span className="acct-row-title">{s.name}</span>
                <span className="acct-row-sub">
                  {s.slug} · {s.status}
                  {s.role === 'collaborator' ? ' · collaborator' : ''}
                </span>
              </div>
              <div className="acct-row-actions">
                <a
                  className="acct-link"
                  href={s.customDomain ? `https://${s.customDomain}` : `/b/${s.slug}`}
                  target="_blank"
                  rel="noreferrer">
                  View site ↗
                </a>
                {s.role === 'owner' ? (
                  <button type="button" className="acct-link" onClick={() => setOpenSlug(openSlug === s.slug ? null : s.slug)}>
                    {openSlug === s.slug ? 'Close' : 'Collaborators'}
                  </button>
                ) : null}
              </div>
              {openSlug === s.slug ? <Collaborators slug={s.slug} /> : null}
            </div>
          ))
        ) : (
          <div className="acct-row">
            <div className="acct-row-meta">
              <span className="acct-row-title">No brands yet</span>
              <span className="acct-row-sub">Create one by talking to Eve in the app</span>
            </div>
          </div>
        )}
      </div>

      <p className="acct-label">Payouts</p>
      <div className="acct-card">
        <div className="acct-row acct-row-plain">
          <div className="acct-row-meta">
            <span className="acct-row-title">{payoutTitle}</span>
            <span className="acct-row-sub">{payoutSub}</span>
          </div>
          <span className={ready ? 'acct-ok' : 'acct-muted'}>{ready ? '✓' : ''}</span>
        </div>
        <div className="acct-actions">
          <button className="btn" type="button" onClick={() => void openPayouts()} disabled={payoutBusy}>
            {payoutBusy ? 'Opening Stripe…' : ready ? 'Manage payouts' : 'Set up payouts'}
          </button>
          {payoutError ? <span className="acct-err">{payoutError}</span> : null}
        </div>
        <p className="acct-hint">
          Payouts are handled by Stripe. Sales are held until the 7-day return window closes, then
          released on the 1st and 15th.
        </p>
      </div>
    </>
  );
}

function Collaborators({ slug }: { slug: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch(`/api/creator/stores/${encodeURIComponent(slug)}/collaborators`);
    if (!res.ok) return setError('Could not load collaborators.');
    const b = (await res.json()) as { collaborators: Member[]; invites: Invite[] };
    setMembers(b.collaborators);
    setInvites(b.invites);
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await apiFetch(`/api/creator/stores/${encodeURIComponent(slug)}/collaborators`, {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(b.error ?? 'Could not send the invitation.');
      setNote(`Invitation sent to ${email}.`);
      setEmail('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the invitation.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(body: { collaboratorId?: string; inviteId?: string }) {
    setError(null);
    const res = await apiFetch(`/api/creator/stores/${encodeURIComponent(slug)}/collaborators`, {
      method: 'DELETE',
      body: JSON.stringify(body),
    });
    if (!res.ok) return setError('Could not remove that.');
    await load();
  }

  return (
    <div className="acct-collab">
      {members.length || invites.length ? (
        <ul className="acct-people">
          {members.map((m) => (
            <li key={m.id}>
              <span>
                {m.name || m.email}
                <em>{m.role}</em>
              </span>
              <button type="button" className="acct-link danger" onClick={() => void remove({ collaboratorId: m.id })}>
                Remove
              </button>
            </li>
          ))}
          {invites.map((i) => (
            <li key={i.id}>
              <span>
                {i.email}
                <em>invited</em>
              </span>
              <button type="button" className="acct-link danger" onClick={() => void remove({ inviteId: i.id })}>
                Revoke
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="acct-hint">No collaborators yet. Invite someone to design and manage this brand with you.</p>
      )}

      <form className="acct-invite" onSubmit={invite}>
        <input
          className="field"
          type="email"
          required
          placeholder="their@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button className="btn ghost" type="submit" disabled={busy || !email.trim()}>
          {busy ? 'Sending…' : 'Invite'}
        </button>
      </form>
      {note ? <p className="acct-ok">{note}</p> : null}
      {error ? <p className="acct-err">{error}</p> : null}
    </div>
  );
}
