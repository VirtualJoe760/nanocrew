import { BetaSignup } from './beta-signup';
import { Footer, Nav } from './site-chrome';

// The homepage, redesigned 2026-08-16 to wear the app's language — Eve's night, her constellation
// (drawn behind everything by app/eve-sky.tsx), platinum accents, Jost. The old numbered
// 01/02/03 steps are gone: they described the product instead of showing it, so the "how it works"
// section is now an actual conversation with Eve that resolves into a finished brand.

const WHAT_YOU_GET = [
  {
    title: 'A shop that runs itself',
    body: 'Printing, shipping, tracking and returns are handled. You never touch inventory, and the money lands in your account on a schedule.',
    icon: (
      <>
        <path d="M4 7h16l-1.3 12.2a2 2 0 0 1-2 1.8H7.3a2 2 0 0 1-2-1.8L4 7Z" />
        <path d="M8.5 7V5.6a3.5 3.5 0 0 1 7 0V7" />
      </>
    ),
  },
  {
    title: 'Your own storefront site',
    body: "Not a profile on someone else's platform — a real website for your brand, generated with it. Change it by telling Eve what to change.",
    icon: (
      <>
        <rect x="3" y="4.5" width="18" height="15" rx="2" />
        <path d="M3 9h18" />
        <circle cx="6.2" cy="6.75" r=".7" fill="currentColor" stroke="none" />
      </>
    ),
  },
  {
    title: 'Designs on demand',
    body: 'Describe a piece and it appears on the garment, ready to sell. Keep the ones you love; the rest cost you nothing but a sentence.',
    icon: <path d="M12 3.6 14.3 9l5.7.5-4.3 3.8 1.3 5.6L12 15.9l-5 3 1.3-5.6L4 9.5 9.7 9 12 3.6Z" />,
  },
];

const THREAD = [
  { who: 'Eve', text: 'Tell me about the brand you want to build.' },
  { who: 'You', text: 'Something for people who run at night. Cold, technical, a little eerie.' },
  {
    who: 'Eve',
    text: "Then it shouldn't feel athletic — it should feel nocturnal. Monochrome, one signal colour, type that reads like instrumentation. I have a name.",
  },
  { who: 'You', text: 'Go on.' },
];

export default function Home() {
  return (
    <>
      <Nav />

      <header className="hero wrap">
        <p className="eyebrow">AI-native creator commerce</p>
        <h1>Speak your brand into existence.</h1>
        <p className="sub">
          Nano Crew turns a conversation into a real clothing brand — a shop, a storefront website,
          and the designs to sell it. Generated for you. Run from your phone.
        </p>
        <div className="cta">
          <a className="btn" href="#beta">
            Create your account
          </a>
          <a className="btn ghost" href="/store">
            Shop Nano Crew
          </a>
        </div>
        <p className="beta-line">
          <span className="dot" /> Private beta on iOS — your account holds your place in line.
        </p>
      </header>

      <div className="wrap">
        <div className="rule" />
      </div>

      <section className="section" id="how">
        <div className="wrap">
          <p className="eyebrow">Meet Eve</p>
          <h2 style={{ fontSize: 'clamp(1.9rem,3.6vw,2.7rem)', margin: '14px 0 12px' }}>
            You talk. She builds.
          </h2>
          <p className="sub" style={{ margin: '0 0 44px' }}>
            Eve interviews you the way a creative director would — then names the brand, sets its
            palette and voice, and stands up the shop behind it.
          </p>

          <div className="talk">
            <div className="thread">
              {THREAD.map((m, i) => (
                <div className={m.who === 'Eve' ? 'msg msg-eve' : 'msg msg-you'} key={i}>
                  <span className="who">{m.who}</span>
                  {m.text}
                </div>
              ))}
            </div>

            <div className="brandcard">
              <span className="label">Brand identity · ready</span>
              <div className="brandname">Night Circuit</div>
              <div className="swatches">
                {['#08080a', '#1b1d22', '#cdd1d9', '#7fd7e6'].map((c) => (
                  <div className="sw" key={c} style={{ background: c }} />
                ))}
              </div>
              <div className="bmeta">
                <span>Voice</span>
                <b>Cold, exact, unhurried</b>
                <span>Type</span>
                <b>Geometric sans, wide tracking</b>
                <span>Shop</span>
                <b>Live · 12 products</b>
                <span>Site</span>
                <b>nightcircuit.shop</b>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="wrap">
        <div className="rule" />
      </div>

      <section className="section" id="get">
        <div className="wrap">
          <p className="eyebrow">What you get</p>
          <h2 style={{ fontSize: 'clamp(1.9rem,3.6vw,2.7rem)', margin: '14px 0 44px' }}>
            A brand, not a template.
          </h2>
          <div className="cards">
            {WHAT_YOU_GET.map((f) => (
              <div className="card" key={f.title}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
                  {f.icon}
                </svg>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="wrap">
        <div className="rule" />
      </div>

      <section className="section" id="beta">
        <div className="wrap beta">
          <div className="beta-copy">
            <p className="eyebrow">Private beta</p>
            <h2>Get in early.</h2>
            <p>
              Nano Crew is on iOS in private beta. Create your account now — it holds your place in
              line, and it&rsquo;s how we pick the next round of testers.
            </p>
            <ul className="perks">
              <li>
                <span className="tick">✦</span> Your place in line, kept against your email
              </li>
              <li>
                <span className="tick">✦</span> Considered for the next TestFlight round
              </li>
              <li>
                <span className="tick">✦</span> Your brand name reserved when you&rsquo;re let in
              </li>
            </ul>
          </div>
          <BetaSignup />
        </div>
      </section>

      <Footer />
    </>
  );
}
