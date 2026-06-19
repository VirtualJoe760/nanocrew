import { eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';

// Push notifications to creators. Sends via Expo's push service to any device tokens
// registered for the store's creator; logs and no-ops when none exist yet (token
// registration is wired separately). Never throws into the caller.

async function sendExpoPush(tokens: string[], title: string, body: string, data?: Record<string, unknown>) {
  const messages = tokens
    .filter((t) => t.startsWith('ExponentPushToken'))
    .map((to) => ({ to, title, body, sound: 'default', data }));
  if (!messages.length) return;
  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(messages),
  }).catch(() => {});
}

/** Tell the creator their requested change is on a preview branch, ready to review. */
export async function notifyRevisionReady(input: { storeId: string; storeName: string; previewUrl: string | null }): Promise<void> {
  try {
    const [store] = await db
      .select({ creatorId: schema.stores.creatorId, slug: schema.stores.slug })
      .from(schema.stores)
      .where(eq(schema.stores.id, input.storeId))
      .limit(1);
    if (!store) return;
    const rows = await db
      .select({ token: schema.deviceTokens.token })
      .from(schema.deviceTokens)
      .where(eq(schema.deviceTokens.creatorId, store.creatorId));
    const tokens = rows.map((r) => r.token);
    const title = `${input.storeName} — changes ready`;
    const body = 'Your update is on a preview. Tap to review and publish it.';
    // slug + name let the tapped push deep-link straight to that store's Edit/review in the app.
    if (tokens.length) await sendExpoPush(tokens, title, body, { kind: 'revision_ready', storeId: input.storeId, slug: store.slug, name: input.storeName });
    else console.log(`[notify] revision ready for ${input.storeName} (${input.previewUrl ?? 'no preview'}) — no push tokens yet`);
  } catch (e) {
    console.error('[notify]', e instanceof Error ? e.message : e);
  }
}
