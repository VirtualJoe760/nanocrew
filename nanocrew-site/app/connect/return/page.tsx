import { redirect } from 'next/navigation';

// This page moved to platform-api (Stripe's Connect return_url points there now);
// redirect so this copy can't drift into a second version.
export default function ConnectReturn() {
  redirect('https://nanocrew-api.vercel.app/connect/return');
}
