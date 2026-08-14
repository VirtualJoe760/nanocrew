// EVE'S EYES — a one-way bus for SHOWING her whatever is on screen.
//
// Follows the design-bus / venus-orb-bus idiom (module-level listener) for the same reason: the
// thing that HAS the picture and the thing that OWNS her live session are different components.
// EveDesign renders inside an overlay; the Gemini Live session lives in EveHome underneath it.
// Rather than drill props through studio.tsx or lift the session (which would undo the overlay
// design), the surface publishes and EveHome subscribes.
//
// DELIBERATELY NOT QUEUED — unlike design-bus. If she isn't live, the sight is DROPPED. Handing her
// a design ten minutes after the moment passed would have her react to something the creator has
// long since moved on from; silence is the better failure.

export type EveSight = {
  /** Image URL (Cloudinary, or a data: URI). */
  url: string;
  /** What she should understand she's looking at — steers her reaction. */
  note?: string;
};

let listener: ((s: EveSight) => void) | null = null;

/** Show Eve something. No-op when she isn't live (see the note above — by design). */
export function showEve(sight: EveSight): void {
  listener?.(sight);
}

/** EveHome registers on mount; returns the unsubscribe. */
export function registerEveVisionListener(fn: (s: EveSight) => void): () => void {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

/** Cloudinary delivery URLs take transforms inline — ask for a small JPEG instead of the full PNG.
 *  Mirrors the idiom in printful.ts (`/upload/` → `/upload/c_scale,w_4500/`), just shrinking rather
 *  than enlarging. Fewer bytes over the wire AND fewer image tokens into the live session. */
function small(url: string): string {
  if (!url.includes('res.cloudinary.com') || !url.includes('/upload/')) return url;
  return url.replace('/upload/', '/upload/c_limit,w_512,q_auto,f_jpg/');
}

/** Uint8Array → base64, chunked (a single String.fromCharCode.apply over a whole image blows the
 *  arg limit). btoa on web; Buffer is the RN fallback — the same pairing venus-lab-screen uses. */
function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
}

/** Fetch an image and return what LiveVoiceSession.sendImage wants. Null on any failure — being
 *  unable to show her something must never break the conversation. */
export async function imageForEve(url: string): Promise<{ base64: string; mimeType: string } | null> {
  try {
    // A data: URI is already encoded — no round trip.
    const m = /^data:([^;]+);base64,(.*)$/.exec(url);
    if (m) return { mimeType: m[1], base64: m[2] };

    const res = await fetch(small(url));
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (!buf.length) return null;
    const mimeType = res.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
    return { base64: toBase64(buf), mimeType };
  } catch {
    return null;
  }
}
