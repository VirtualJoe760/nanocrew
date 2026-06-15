import dns from 'node:dns/promises';
import net from 'node:net';

// SSRF guard for server-side fetches of client-supplied URLs (e.g. /api/composite). An
// authed user could otherwise point us at cloud metadata (169.254.169.254), localhost, or
// internal Railway services. We allow only public http(s) hosts, block private/link-local
// targets (by literal AND by resolved DNS), and refuse redirects (which could hop internal).

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true; // this-host, private, loopback
    if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    return (
      low === '::1' || // loopback
      low === '::' ||
      low.startsWith('fc') || // unique-local
      low.startsWith('fd') ||
      low.startsWith('fe80') || // link-local
      low.startsWith('::ffff:') // IPv4-mapped — treat conservatively
    );
  }
  return true; // unparseable → block
}

/** Validate a URL is a public http(s) target, then fetch it with redirects disabled. */
export async function safeImageFetch(rawUrl: string): Promise<Response> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw new Error('Only http(s) URLs are allowed');
  }
  const host = u.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('Blocked host');
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error('Blocked private address');
  } else {
    const addrs = await dns.lookup(host, { all: true });
    if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) {
      throw new Error('Blocked private address');
    }
  }
  return fetch(rawUrl, { redirect: 'error' });
}
