// Shared HTML for the Simli avatar frame — used by BOTH the web renderer (<iframe srcDoc>) and the
// native renderer (<WebView source.html>). simli-client is a browser/WebRTC SDK that doesn't bundle
// cleanly under Metro (its internal `./Client` import fails to resolve), so instead of importing it
// into the app we load it from a CDN INSIDE the frame. Only the short-lived session token is embedded
// — never the SIMLI_API_KEY. LiveKit transport supplies its own ICE, so no key/ICE is needed here.
// `handleSilence` (set server-side) keeps her idling live with no audio; piping Venus's Gemini PCM
// (postMessage → sendAudioData, 16kHz) is the next phase. See docs/studio/VENUS_AVATAR.md "Simli".

export function buildSimliHtml(token: string): string {
  return `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>html,body{margin:0;height:100%;background:#06080f;overflow:hidden}
video{width:100%;height:100%;object-fit:contain;display:block}
#s{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;color:#7cc7df;font-family:sans-serif;font-size:14px;letter-spacing:1px}</style>
</head><body>
<video id="v" autoplay playsinline muted></video>
<audio id="a" autoplay></audio>
<div id="s">[ connecting to Simli… ]</div>
<script type="module">
// NB: import the lowercase module file directly, not the package root — simli-client@3.0.2's
// index.js does require("./Client") but ships client.js (lowercase), which 500s on case-sensitive
// CDN bundlers (esm.sh/jsdelivr). .../dist/client.js sidesteps the broken index and exports cleanly.
import { SimliClient, LogLevel } from 'https://esm.sh/simli-client@3.0.2/dist/client.js';
const v=document.getElementById('v'),a=document.getElementById('a'),s=document.getElementById('s');
try {
  const c = new SimliClient(${JSON.stringify(token)}, v, a, null, LogLevel.ERROR, 'livekit');
  c.on('start', () => { s.style.display='none'; });
  c.on('error', (d) => { s.textContent='Simli error: '+d; });
  await c.start();
} catch (e) { s.textContent='Simli error: '+((e&&e.message)||e); }
</script>
</body></html>`;
}
