import { apiFetch, readJson } from '@/lib/api';

// Shared HTML for the Simli avatar frame — used by BOTH the web renderer (<iframe srcDoc>) and the
// native renderer (<WebView source.html>). simli-client is a browser/WebRTC SDK that doesn't bundle
// cleanly under Metro (its internal `./Client` import fails to resolve), so instead of importing it
// into the app we load it from a CDN INSIDE the frame. Only the short-lived session token is embedded
// — never the SIMLI_API_KEY. LiveKit transport supplies its own ICE, so no key/ICE is needed here.
//
// VOICE: she speaks in her Gemini voice (Aoede). The renderer fetches Simli-ready PCM from the gated
// /api/simli/tts route (Gemini TTS, resampled to 16kHz) and hands it to the frame — web via
// postMessage({type:'simli-speak'}), native via injectJavaScript(window.__simliSpeak(...)). The frame
// base64-decodes and feeds it to client.sendAudioData() in 16kHz chunks. See VENUS_AVATAR.md "Simli".

/** Imperative handle both renderers expose so the Lab can make Venus speak a line.
 *  `voice` (optional) auditions a different Gemini prebuilt voice — see the tts route's allowlist. */
export type SimliVenusHandle = { speak: (text: string, voice?: string) => Promise<void> };

/** Fetch Venus's line as Simli-ready 16kHz PCM16 (base64) from the gated Gemini-TTS route. */
export async function synthSimliPcm(text: string, voice?: string): Promise<string | null> {
  const { pcm } = await readJson<{ pcm?: string }>(
    await apiFetch('/api/simli/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, ...(voice ? { voice } : {}) }),
    }),
  );
  return pcm ?? null;
}

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
let c=null, speakSeq=0;
// Feed base64 PCM16 (16kHz mono) into Simli's lip-synced playback. Each new line first SKIPs any
// audio still playing (so you can interrupt and re-test freely), then streams 6kB (~0.19s) chunks
// PACED at ~real-time. Flooding every chunk at once overruns Simli's buffer and wedges the session
// after the first utterance (the "only speaks once" bug). A bumped speakSeq supersedes an in-flight line.
async function speak(b64){
  if(!c||!b64) return;
  const seq=++speakSeq;
  try{ if(c.ClearBuffer) c.ClearBuffer(); }catch(e){}
  const bin=atob(b64), bytes=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
  const CHUNK=6000;
  for(let o=0;o<bytes.length;o+=CHUNK){
    if(seq!==speakSeq) return;                                              // superseded by a newer line
    try{ c.sendAudioData(bytes.subarray(o,Math.min(o+CHUNK,bytes.length))); }catch(e){ return; }
    await new Promise(r=>setTimeout(r,150));                                // pace so the stream stays healthy
  }
}
window.__simliSpeak=speak; // native: injectJavaScript(window.__simliSpeak("..."))
window.addEventListener('message',function(e){ if(e&&e.data&&e.data.type==='simli-speak') speak(e.data.pcm); }); // web
try {
  c = new SimliClient(${JSON.stringify(token)}, v, a, null, LogLevel.ERROR, 'livekit');
  c.on('start', () => { s.style.display='none'; });
  c.on('error', (d) => { s.textContent='Simli error: '+d; });
  await c.start();
} catch (e) { s.textContent='Simli error: '+((e&&e.message)||e); }
</script>
</body></html>`;
}
