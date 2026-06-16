import { Footer, Nav } from './site-chrome';
import { WaitlistForm } from './waitlist-form';

const FEATURES = [
  {
    n: '01',
    title: 'Talk to Venus',
    body: 'Describe your brand out loud — or type it. Venus interviews you and designs the whole identity: name, voice, logo, palette.',
  },
  {
    n: '02',
    title: 'Get a shop and a site',
    body: 'Nano Crew generates a shop and a custom storefront website for your brand — checkout and fulfillment handled for you from day one.',
  },
  {
    n: '03',
    title: 'Design and sell',
    body: 'Create products by prompt and post from your phone. When you make a sale, our online fulfillment prints your design and ships it — you never touch inventory. And you can redesign your site just by talking to it.',
  },
];

export default function Home() {
  return (
    <>
      <Nav />

      <header className="hero wrap">
        <p className="eyebrow">AI-native creator commerce</p>
        <h1>Speak your brand into existence.</h1>
        <p className="sub">
          Nano Crew turns a conversation into a real clothing brand — a shop, a storefront website, and
          the content to sell it. Generated for you. Run from your phone.
        </p>
        <div className="cta">
          <a className="btn" href="#waitlist">
            Join the waitlist
          </a>
          <span className="soon">📱 Coming soon to iOS</span>
        </div>
      </header>

      <section className="section" id="how">
        <div className="wrap">
          <p className="kicker">How it works</p>
          <div className="grid3">
            {FEATURES.map((f) => (
              <div className="feat" key={f.n}>
                <div className="n">{f.n}</div>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section" id="waitlist">
        <div className="wrap waitlist">
          <h2>Be first in line.</h2>
          <p>
            Nano Crew launches on iOS soon. Leave your email and we&rsquo;ll let you know the moment you
            can build your brand.
          </p>
          <WaitlistForm />
        </div>
      </section>

      <Footer />
    </>
  );
}
