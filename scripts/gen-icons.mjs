// Generate the Nano Crew app icon set from the NC monogram (serif mark + brushed-silver metallic
// gradient on a dark charcoal field, per the asset sheet). Renders every slot app.json references.
//   node scripts/gen-icons.mjs
import sharp from 'sharp';

const OUT = new URL('../assets/images/', import.meta.url);
const SERIF = "Georgia, 'Times New Roman', 'Times', serif";

const metalDefs = `
  <linearGradient id="metal" x1="0.12" y1="0" x2="0.9" y2="1">
    <stop offset="0" stop-color="#ffffff"/>
    <stop offset="0.42" stop-color="#d6d9df"/>
    <stop offset="0.7" stop-color="#9aa0aa"/>
    <stop offset="1" stop-color="#eef0f3"/>
  </linearGradient>`;

// NC text, centred, with negative tracking so the N and C nearly touch (like the mark).
const mark = (size, fill, scale = 1) => {
  const fs = size * 0.56 * scale;
  return `<text x="${size / 2}" y="${size / 2 + fs * 0.36}" fill="${fill}" font-family="${SERIF}" font-size="${fs}" font-weight="500" text-anchor="middle" letter-spacing="${-fs * 0.13}">NC</text>`;
};

const fieldDefs = `
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#202024"/><stop offset="1" stop-color="#0e0e10"/></linearGradient>
  <radialGradient id="sheen" cx="38%" cy="28%" r="62%"><stop offset="0" stop-color="#3a3a42" stop-opacity="0.7"/><stop offset="1" stop-color="#3a3a42" stop-opacity="0"/></radialGradient>`;

const iconSvg = (size) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg"><defs>${fieldDefs}${metalDefs}</defs>` +
  `<rect width="${size}" height="${size}" fill="url(#bg)"/><rect width="${size}" height="${size}" fill="url(#sheen)"/>${mark(size, 'url(#metal)')}</svg>`;

// Transparent mark only (for splash + android foreground); scale shrinks it into the safe zone.
const markSvg = (size, fill, scale) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg"><defs>${metalDefs}</defs>${mark(size, fill, scale)}</svg>`;

const png = (svg, file) => sharp(Buffer.from(svg)).png().toFile(new URL(file, OUT).pathname);

await png(iconSvg(1024), 'icon.png');
await png(markSvg(1024, 'url(#metal)', 1), 'splash-icon.png'); // mark on transparent → sits on splash bg
await png(markSvg(1024, 'url(#metal)', 0.62), 'android-icon-foreground.png'); // padded into the adaptive safe zone
await png(`<svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg"><rect width="1024" height="1024" fill="#16161a"/></svg>`, 'android-icon-background.png');
await png(markSvg(1024, '#ffffff', 0.62), 'android-icon-monochrome.png');
await png(iconSvg(196), 'favicon.png');

console.log('wrote icon.png, splash-icon.png, android-icon-{foreground,background,monochrome}.png, favicon.png');
