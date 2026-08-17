import { AccountPanel } from './account-panel';
import { Footer, Nav } from '../site-chrome';

// nanocrew.app/account — the site's ONE signed-in function (Joe, 2026-08-16): edit the account
// details the app shows read-only. Layout mirrors src/app/account.tsx — the ACCOUNT eyebrow, the
// avatar/email/plan/creator-id header, then grouped sections.

export const metadata = { title: 'Account — Nano Crew' };

export default function AccountPage() {
  return (
    <>
      <Nav />
      <main className="wrap account">
        <p className="eyebrow">Account</p>
        <AccountPanel />
      </main>
      <Footer />
    </>
  );
}
