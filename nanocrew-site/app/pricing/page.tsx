import type { Metadata } from 'next';

import { Footer, Nav } from '../site-chrome';

export const metadata: Metadata = { title: 'Pricing — Nano Crew' };

// Web prices — lower than in-app because there's no app-store cut. Checkout is
// minted from the app (Account → billing), so this page informs; it doesn't sell.
const PLANS = [
  {
    name: 'Starter',
    price: '$10',
    body: '500 credits a month and 1 brand — everything you need to launch and start selling.',
  },
  {
    name: 'Pro',
    price: '$50',
    body: '3,000 credits a month, plus your own storefront website on a custom domain.',
  },
  {
    name: 'Advanced',
    price: '$175',
    body: '12,000 credits a month — the most credits, with the website and custom domain included.',
  },
];

export default function Pricing() {
  return (
    <>
      <Nav />

      <header className="hero wrap">
        <p className="eyebrow">Pricing</p>
        <h1>Simple plans, web prices.</h1>
        <p className="sub">
          Subscribing on the web costs less than in-app — there&rsquo;s no app-store cut, so the
          saving goes to you.
        </p>
      </header>

      <section className="section">
        <div className="wrap">
          <p className="kicker">Plans</p>
          <div className="grid3">
            {PLANS.map((p) => (
              <div className="feat" key={p.name}>
                <div className="n">{p.price}/mo</div>
                <h3>{p.name}</h3>
                <p>{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap waitlist">
          <h2>Plans are managed in the app.</h2>
          <p>
            Pick a plan — or switch any time — from <strong>Account</strong> in the Nano Crew app;
            your subscription applies everywhere you use Nano Crew.
          </p>
          <a className="btn" href="nanocrew://account">
            Open the Nano Crew app
          </a>
          <p style={{ marginTop: 16 }}>
            Don&rsquo;t have it yet? <a href="/#beta">Get the app</a>.
          </p>
        </div>
      </section>

      <Footer />
    </>
  );
}
