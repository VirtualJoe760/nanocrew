import { getUserFromRequest } from '@/lib/auth';
import { CREDIT_PACKS, TIERS, countBrands, getEntitlements } from '@/lib/billing';

// GET /api/creator/subscription — the creator's plan + entitlements, how many brands they
// have vs their cap, and the catalogue of tiers/credit packs so the paywall can render
// without hardcoding prices.
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const [entitlements, brandCount] = await Promise.all([getEntitlements(user.id), countBrands(user.id)]);
    return Response.json({
      entitlements,
      brandCount,
      canLaunch: entitlements.active && brandCount < entitlements.maxBrands,
      tiers: Object.values(TIERS),
      creditPacks: CREDIT_PACKS,
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
