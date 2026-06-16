// Customer notifications. Resend-backed when RESEND_API_KEY + EMAIL_FROM are set;
// otherwise logs and returns — the tracking data still lands on the order row and
// the creator dashboard, so nothing is lost while email is unconfigured.

export async function sendShippedEmail(opts: {
  to: string;
  brandName: string;
  items: string[];
  trackingNumber?: string | null;
  trackingUrl?: string | null;
}): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM; // e.g. "Nano Crew <orders@nanocrew.app>"
  if (!key || !from) {
    console.log(`[notify] email unconfigured — would tell ${opts.to}: ${opts.brandName} order shipped (${opts.trackingNumber ?? 'no tracking #'})`);
    return;
  }
  const tracking = opts.trackingUrl
    ? `<p><a href="${opts.trackingUrl}">Track your package</a>${opts.trackingNumber ? ` — ${opts.trackingNumber}` : ''}</p>`
    : opts.trackingNumber
      ? `<p>Tracking number: ${opts.trackingNumber}</p>`
      : '';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [opts.to],
      subject: `Your ${opts.brandName} order is on its way`,
      html: `<div style="font-family:sans-serif;max-width:480px">
<h2>Your order shipped.</h2>
<p>${opts.items.join(', ')} — made to order by ${opts.brandName}, now headed your way.</p>
${tracking}
<p style="color:#777">Sent by Nano Crew on behalf of ${opts.brandName}.</p>
</div>`,
    }),
  });
  if (!res.ok) console.error(`[notify] resend failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
}
