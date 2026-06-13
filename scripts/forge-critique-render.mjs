// Render annotated critique screenshots on the forge.
//   node render.mjs <annotationsJson> <outDir>
// annotationsJson: [{ url, width, strokes: [[{x,y}, ...], ...] }]  (strokes in document coords)
// Writes shot-1.png, shot-2.png … cropped to each circled region with the gold marks drawn in.
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const jsonPath = process.argv[2];
const outDir = process.argv[3] || '.';
mkdirSync(outDir, { recursive: true });

let anns = [];
try {
  anns = JSON.parse(readFileSync(jsonPath, 'utf8'));
} catch {
  process.exit(0);
}
if (!Array.isArray(anns) || !anns.length) process.exit(0);

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
let n = 0;
for (const a of anns) {
  n++;
  const strokes = Array.isArray(a?.strokes) ? a.strokes.filter((s) => Array.isArray(s) && s.length > 1) : [];
  if (!a?.url || !strokes.length) continue;
  const width = Math.max(320, Math.min(1440, Math.round(a.width || 390)));
  let page;
  try {
    page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 2 });
    await page.goto(a.url, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(900); // let fonts/images settle
    const fullH = await page.evaluate(() => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight));
    const vh = Math.min(Math.max(fullH, 900), 6000);
    await page.setViewportSize({ width, height: vh });
    await page.evaluate(
      ({ strokes, width, h }) => {
        const NS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('width', String(width));
        svg.setAttribute('height', String(h));
        svg.setAttribute('style', `position:absolute;left:0;top:0;width:${width}px;height:${h}px;z-index:2147483647;pointer-events:none;`);
        for (const s of strokes) {
          const pl = document.createElementNS(NS, 'polyline');
          pl.setAttribute('points', s.map((p) => `${p.x},${p.y}`).join(' '));
          pl.setAttribute('fill', 'none');
          pl.setAttribute('stroke', '#c9a86a');
          pl.setAttribute('stroke-width', '4');
          pl.setAttribute('stroke-linecap', 'round');
          pl.setAttribute('stroke-linejoin', 'round');
          svg.appendChild(pl);
        }
        document.body.appendChild(svg);
      },
      { strokes, width, h: vh },
    );
    const pts = strokes.flat();
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const pad = 48;
    const x = Math.max(0, Math.min(...xs) - pad);
    const y = Math.max(0, Math.min(...ys) - pad);
    const cw = Math.min(width - x, Math.max(...xs) - Math.min(...xs) + pad * 2);
    const ch = Math.min(vh - y, Math.max(...ys) - Math.min(...ys) + pad * 2);
    try {
      await page.screenshot({ path: join(outDir, `shot-${n}.png`), clip: { x, y, width: Math.max(48, cw), height: Math.max(48, ch) } });
    } catch {
      await page.screenshot({ path: join(outDir, `shot-${n}.png`), fullPage: true });
    }
  } catch {
    /* skip this shot */
  } finally {
    if (page) await page.close().catch(() => {});
  }
}
await browser.close();
console.log('SHOTS_DONE');
