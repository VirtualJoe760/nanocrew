// Generate the Nano Crew app icon set from the new raster art (the neon-bob Venus icon).
// The source (assets/brand/app-icon-source.png) is a rounded app-icon mockup on a WHITE field; iOS
// needs an OPAQUE, full-bleed square. We recolor the white margin + rounded corners to black (only
// in the outer/corner zone, radial > 0.85, so the central eye glints stay), then render every slot
// app.json references.
//   node scripts/gen-app-icon.mjs
import sharp from 'sharp';

const SRC = new URL('../assets/brand/app-icon-source.png', import.meta.url).pathname;
const IMG = new URL('../assets/images/', import.meta.url);
const BRAND = new URL('../assets/brand/', import.meta.url);
const p = (dir, file) => new URL(file, dir).pathname;

// 1. De-white the corners/margin (preserve the central eye glints).
const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H, channels: ch } = info;
const cx = (W - 1) / 2;
const cy = (H - 1) / 2;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * ch;
    if (data[i] > 238 && data[i + 1] > 238 && data[i + 2] > 238) {
      const nx = (x - cx) / cx;
      const ny = (y - cy) / cy;
      if (Math.hypot(nx, ny) > 0.85) {
        data[i] = 0; data[i + 1] = 0; data[i + 2] = 0;
        if (ch > 3) data[i + 3] = 255;
      }
    }
  }
}
const clean = await sharp(data, { raw: { width: W, height: H, channels: ch } }).png().toBuffer();
const square = (size) => sharp(clean).resize(size, size, { fit: 'cover' }).flatten({ background: '#000000' }).png();

// 2. iOS app icon + App Store marketing icon (opaque, full-bleed) + web favicon.
await square(1024).toFile(p(IMG, 'icon.png'));
await square(1024).toFile(p(BRAND, 'app-icon-1024.png'));
await square(196).toFile(p(IMG, 'favicon.png'));

// 3. Android adaptive: subject scaled into the safe zone on transparent; dark background; grayscale mono.
const fgInner = Math.round(1024 * 0.7);
const fg = await sharp(clean).resize(fgInner, fgInner, { fit: 'cover' }).png().toBuffer();
const onCanvas = (input) =>
  sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input, gravity: 'center' }])
    .png();
await onCanvas(fg).toFile(p(IMG, 'android-icon-foreground.png'));
await sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#0a0a12' } }).png().toFile(p(IMG, 'android-icon-background.png'));
await onCanvas(await sharp(fg).grayscale().png().toBuffer()).toFile(p(IMG, 'android-icon-monochrome.png'));

console.log('app icon set regenerated from assets/brand/app-icon-source.png → icon.png, app-icon-1024.png, favicon.png, android-icon-{foreground,background,monochrome}.png');
