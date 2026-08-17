'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

// Eve's field, behind every page — her starfield plus the constellation, breathing, with a slight
// parallax to the cursor. This is the site's echo of how the app mounts ONE persistent avatar at
// its root (src/components/eve/eve-background.tsx): the ground never changes, the content moves
// over it.
//
// Deliberately Canvas 2D rather than react-three-fiber + the venus-* modules: this page's whole job
// is getting someone to sign up, and the full avatar would cost hundreds of KB at the front door.
// The geometry matches eve-glyph.tsx exactly, so it still reads as unmistakably her.

const NODES: [number, number][] = [[30, 32], [92, 26], [102, 64], [82, 98], [50, 104], [22, 82], [16, 48], [70, 18]];
const MIDS: [number, number][] = [[45, 46], [80, 52], [66, 82]];

export function EveSky() {
  const ref = useRef<HTMLCanvasElement>(null);
  // Her starfield is everywhere; the constellation itself is the homepage's hero, so it would
  // only compete with content on the store, legal and checkout pages.
  const constellation = usePathname() === '/';

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let W = 0, H = 0, t = 0, mx = 0, my = 0, tx = 0, ty = 0, raf = 0, sy = 0;
    let stars: { x: number; y: number; r: number; o: number; p: number; d: number }[] = [];

    function seed() {
      let s = 11;
      const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
      stars = Array.from({ length: Math.min(260, Math.round((W * H) / 7000)) }, () => ({
        x: rnd() * W, y: rnd() * H, r: 0.3 + rnd() * 1.15, o: 0.06 + rnd() * 0.26, p: rnd() * 6.28, d: 0.15 + rnd() * 0.5,
      }));
    }
    function size() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      W = window.innerWidth; H = window.innerHeight;
      c!.width = W * dpr; c!.height = H * dpr;
      c!.style.width = `${W}px`; c!.style.height = `${H}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    }
    function onMove(e: MouseEvent) { tx = e.clientX / W - 0.5; ty = e.clientY / H - 0.5; }
    function onScroll() { sy = window.scrollY; }

    function glyph(cx: number, cy: number, scale: number, breath: number, fade = 1) {
      const P = (x: number, y: number): [number, number] => [cx + (x - 60) * scale, cy + (y - 60) * scale];
      const g = ctx!.createRadialGradient(cx, cy, 0, cx, cy, 58 * scale);
      g.addColorStop(0, `rgba(127,215,230,${(0.16 * breath * fade).toFixed(3)})`);
      g.addColorStop(0.55, `rgba(127,215,230,${(0.05 * breath * fade).toFixed(3)})`);
      g.addColorStop(1, 'rgba(127,215,230,0)');
      ctx!.fillStyle = g;
      ctx!.beginPath(); ctx!.arc(cx, cy, 58 * scale, 0, 6.2832); ctx!.fill();

      ctx!.lineWidth = Math.max(0.6, 1.15 * scale);
      NODES.forEach(([x, y], i) => {
        const w = 0.5 + 0.28 * Math.sin(t * 0.7 + i * 0.9);
        ctx!.strokeStyle = `rgba(127,215,230,${(w * breath * fade).toFixed(3)})`;
        const [px, py] = P(x, y);
        ctx!.beginPath(); ctx!.moveTo(cx, cy); ctx!.lineTo(px, py); ctx!.stroke();
      });
      NODES.forEach(([x, y], i) => {
        const [px, py] = P(x, y);
        const pulse = 1 + 0.16 * Math.sin(t * 0.9 + i * 1.3);
        ctx!.fillStyle = `rgba(127,215,230,${(0.85 * fade).toFixed(3)})`;
        ctx!.beginPath(); ctx!.arc(px, py, 2.2 * scale * pulse, 0, 6.2832); ctx!.fill();
      });
      MIDS.forEach(([x, y], i) => {
        const [px, py] = P(x, y);
        ctx!.fillStyle = `rgba(127,215,230,${((0.45 + 0.2 * Math.sin(t + i)) * fade).toFixed(3)})`;
        ctx!.beginPath(); ctx!.arc(px, py, 1.55 * scale, 0, 6.2832); ctx!.fill();
      });
      ctx!.fillStyle = `rgba(234,244,249,${(0.13 * fade).toFixed(3)})`;
      ctx!.beginPath(); ctx!.arc(cx, cy, 11 * scale * breath, 0, 6.2832); ctx!.fill();
      ctx!.fillStyle = `rgba(234,244,249,${fade.toFixed(3)})`;
      ctx!.beginPath(); ctx!.arc(cx, cy, 7 * scale * breath, 0, 6.2832); ctx!.fill();
      ctx!.strokeStyle = `rgba(127,215,230,${(0.7 * fade).toFixed(3)})`;
      ctx!.lineWidth = Math.max(0.6, 1.15 * scale);
      ctx!.beginPath(); ctx!.arc(cx, cy, 11 * scale * breath, 0, 6.2832); ctx!.stroke();
    }

    function frame() {
      t += reduce ? 0 : 0.012;
      mx += (tx - mx) * 0.045; my += (ty - my) * 0.045;
      ctx!.clearRect(0, 0, W, H);
      for (const s of stars) {
        const tw = reduce ? 1 : 0.75 + 0.25 * Math.sin(t * s.d * 3 + s.p);
        ctx!.fillStyle = `rgba(127,215,230,${(s.o * tw).toFixed(3)})`;
        ctx!.beginPath(); ctx!.arc(s.x + mx * 14 * s.d, s.y + my * 14 * s.d, s.r, 0, 6.2832); ctx!.fill();
      }
      // She belongs to the hero. Past it she fades out rather than trailing down the page and
      // sitting on top of the copy — the starfield alone carries the rest.
      const heroFade = Math.max(0, Math.min(1, 1 - sy / (H * 0.62)));
      if (constellation && heroFade > 0.01) {
        const wide = W > 900;
        const cx = wide ? W * 0.76 : W * 0.5;
        const cy = wide ? H * 0.42 : H * 0.125; // clear of the eyebrow on phones
        const scale = wide ? Math.min(W, H) / 300 : Math.min(W, H) / 620;
        glyph(cx + mx * 26, cy + my * 26, scale, (1 + (reduce ? 0 : 0.045 * Math.sin(t * 0.8))) * heroFade, heroFade);
      }
      raf = requestAnimationFrame(frame);
    }

    size();
    window.addEventListener('resize', size, { passive: true });
    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    frame();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', size);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('scroll', onScroll);
    };
  }, [constellation]);

  return <canvas className="eve-sky" ref={ref} aria-hidden="true" />;
}
