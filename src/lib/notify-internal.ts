// Fire-and-forget bridge from the Railway app to the platform-api central notify route
// (INTERNAL_API_KEY-gated). Resend lives ONLY in platform-api, so app-side actions that should send a
// branded email post a minimal payload here and platform-api resolves the rest + sends. Best-effort:
// never throws into the caller, and no-ops in dev when PLATFORM_API_BASE / INTERNAL_API_KEY are unset.
// See platform-api/app/api/internal/notify/route.ts for the accepted actions.
export async function notifyPlatform(payload: Record<string, unknown>): Promise<void> {
  try {
    const base = (process.env.PLATFORM_API_BASE ?? '').trim().replace(/\/+$/, '');
    const key = process.env.INTERNAL_API_KEY;
    if (!base || !key) return;
    await fetch(`${base}/api/internal/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': key },
      body: JSON.stringify(payload),
    });
  } catch {
    // best-effort — a notify failure must never break the caller's action
  }
}
