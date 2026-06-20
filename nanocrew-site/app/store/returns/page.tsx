import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Returns & Claims — Nano Crew' };

export default function Returns() {
  return (
    <main className="wrap prose">
      <h1>Returns &amp; Claims</h1>
      <p className="updated">For the Nano Crew store and every brand store on Nano Crew.</p>

      <p>
        Every piece is made to order, so we can&apos;t accept buyer&apos;s-remorse returns or size swaps.
        What we&apos;ll always make right is a problem with the item itself.
      </p>

      <h2>You can open a claim if your order is</h2>
      <ul>
        <li>
          <strong>Defective</strong> — a misprint, a flaw, or a manufacturing fault
        </li>
        <li>
          <strong>Wrong item</strong> — not what you ordered (wrong product, color, or size)
        </li>
        <li>
          <strong>Damaged</strong> — it arrived damaged in transit
        </li>
        <li>
          <strong>Not received</strong> — tracking says delivered but it never arrived
        </li>
      </ul>

      <h2>The window</h2>
      <p>
        You have <strong>7 days from the day your order ships</strong> to open a claim. After that, the
        claim window has closed.
      </p>

      <h2>How to request</h2>
      <p>
        Head to <Link href="/store/returns/request">Request a return</Link>, enter the email you ordered
        with and your order number (it&apos;s in your confirmation email), then pick the issue. For a
        defective or damaged item, add a photo of the problem — we need it to make it right. We&apos;ll
        review and email you with the resolution: a free reprint or a refund.
      </p>

      <p>
        <Link className="btn ghost" href="/store/returns/request">
          Request a return
        </Link>
      </p>
    </main>
  );
}
