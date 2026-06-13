import type { Metadata } from 'next';

import { Footer, Nav } from '../site-chrome';

export const metadata: Metadata = { title: 'Contact — Nanocrew' };

export default function Contact() {
  return (
    <>
      <Nav />
      <main className="wrap prose">
        <h1>Contact</h1>
        <p>We&rsquo;d love to hear from you. The fastest way to reach us is email.</p>

        <h2>Support</h2>
        <p>
          Help with an order, your brand, or your account:{' '}
          <a href="mailto:support@nanocrew.app">support@nanocrew.app</a>
        </p>

        <h2>Privacy &amp; data requests</h2>
        <p>
          <a href="mailto:privacy@nanocrew.app">privacy@nanocrew.app</a>
        </p>

        <h2>Business &amp; press</h2>
        <p>
          <a href="mailto:hello@nanocrew.app">hello@nanocrew.app</a>
        </p>

        <p className="updated" style={{ marginTop: 36 }}>
          Nanocrew — AI-native creator commerce.
        </p>
      </main>
      <Footer />
    </>
  );
}
