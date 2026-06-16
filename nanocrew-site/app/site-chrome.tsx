import Link from 'next/link';

export function Nav() {
  return (
    <nav className="nav wrap">
      <Link href="/" className="mark" aria-label="Nano Crew — home">
        <span className="nc">NC</span>
        <span className="word">Nano Crew</span>
      </Link>
      <div className="links">
        <Link href="/store">Store</Link>
        <a href="/#how">How it works</a>
        <a href="/#waitlist">Waitlist</a>
        <Link href="/contact">Contact</Link>
      </div>
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
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/contact">Contact</Link>
        </div>
      </div>
    </footer>
  );
}
