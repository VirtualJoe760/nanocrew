// Brand sites live on their own origins (*.vercel.app, custom domains later), so
// every route answers cross-origin: browsers preflight POSTs and Authorization'd GETs.

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
} as const;

export function corsJson(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, { ...init, headers: { ...CORS_HEADERS, ...init?.headers } });
}

export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
