import { eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';
import { TenantError, assertProductOwner } from '@/lib/tenant';
import { deleteSyncProduct } from '@/lib/printful';
import { revalidateStorefront } from '@/lib/storefront-revalidate';

// DELETE /api/creator/products/:id — remove a product everywhere the creator owns it:
//   1. Printful store (the sync product) — best-effort, so a Printful hiccup never strands the
//      catalog row half-deleted; a 404 there just means it's already gone.
//   2. our DB — variants cascade via FK; order_items keep their name snapshot so history survives.
//   3. the storefront website refreshes itself (templates use ISR `revalidate: 300` ≈ 5 min).
export async function DELETE(req: Request, { id }: Record<string, string>) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
  try {
    const { slug, printfulSyncProductId } = await assertProductOwner(id, user.id);
    if (printfulSyncProductId) {
      try {
        await deleteSyncProduct(printfulSyncProductId);
      } catch (e) {
        // Never strand the catalog row on a Printful error — log and remove ours anyway.
        console.error('[products.DELETE] printful:', e instanceof Error ? e.message : e);
      }
    }
    await db.delete(schema.products).where(eq(schema.products.id, id));
    // Refresh the brand's storefront so the live site matches the app catalogue (fire-and-forget).
    void revalidateStorefront(slug);
    return Response.json({ ok: true });
  } catch (e) {
    const status = e instanceof TenantError ? e.status : 500;
    return Response.json({ error: e instanceof Error ? e.message : 'Failed to delete product' }, { status });
  }
}
