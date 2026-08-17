'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { authConfigured, supabase } from '@/lib/supabase';

import { EveMark } from './eve-mark';

const NAV_LINKS = [
  { href: '/store', label: 'Store' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/#how', label: 'How it works' },
  { href: '/#beta', label: 'Beta' },
  { href: '/contact', label: 'Contact' },
];

export function Nav() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  // Signed-in creators get an Account entry — the site's one signed-in surface. Rendered only
  // once we KNOW there's a session, so the nav never flashes a link a signed-out visitor can't use.
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    if (!authConfigured) return;
    void supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, sess) => setSignedIn(!!sess));
    return () => sub.subscription.unsubscribe();
  }, []);
  const links = signedIn ? [...NAV_LINKS, { href: '/account', label: 'Account' }] : NAV_LINKS;
  return (
    <nav className="nav wrap">
      <Link href="/" className="mark" aria-label="Nano Crew — home" onClick={close}>
        <span className="nc"><EveMark size={34} /></span>
        <span className="word">Nano Crew</span>
      </Link>

      {/* Desktop: inline links */}
      <div className="links links-desktop">
        {links.map((l) => (
          <Link key={l.href} href={l.href}>
            {l.label}
          </Link>
        ))}
      </div>

      {/* Mobile: hamburger toggle */}
      <button
        type="button"
        className="nav-toggle"
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`burger${open ? ' open' : ''}`} aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </button>

      {/* Mobile: dropdown panel (wraps to its own row in the flex nav) */}
      {open ? (
        <div className="links-mobile">
          {links.map((l) => (
            <Link key={l.href} href={l.href} onClick={close}>
              {l.label}
            </Link>
          ))}
        </div>
      ) : null}
    </nav>
  );
}

export function Footer() {
  const year = 2026;
  return (
    <footer className="footer">
      <div className="wrap row">
        <span className="copy">© {year} Nano Crew. All rights reserved.</span>
        <div className="links">
          <Link href="/store/returns">Returns</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/contact">Contact</Link>
        </div>
      </div>
    </footer>
  );
}
