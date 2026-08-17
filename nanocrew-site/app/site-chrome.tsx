'use client';

import Link from 'next/link';
import { useState } from 'react';

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
  return (
    <nav className="nav wrap">
      <Link href="/" className="mark" aria-label="Nano Crew — home" onClick={close}>
        <span className="nc"><EveMark size={34} /></span>
        <span className="word">Nano Crew</span>
      </Link>

      {/* Desktop: inline links */}
      <div className="links links-desktop">
        {NAV_LINKS.map((l) => (
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
          {NAV_LINKS.map((l) => (
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
