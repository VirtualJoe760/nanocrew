import { useEffect, useMemo, useState } from 'react';

// SUBTITLES THAT FOLLOW HER VOICE, NOT THE TRANSCRIPT STREAM (Joe, 2026-08-19: "the subtitling went
// wayyyy too fast, it didn't follow the speech… we want it to be word for word — across all
// subtitles"). The Live model streams her words as it generates them, seconds ahead of the audio it
// is still sending, so painting the transcript as it lands races her voice badly.
//
// The Live API gives no per-word timings, but the session knows exactly when its queued audio
// starts and ends in wall-clock (`onSpeechWindow` → `playStartedAt`/`playEndsAt` in live-voice.ts).
// So we reveal the words she has generated across the audio she is actually playing: at 40% through
// the sound, 40% of the words are on screen. It self-corrects as more audio arrives (the window
// grows), never runs ahead of her, and lands on the last word as she stops speaking.

export type SpeechWindow = { startedAt: number; endsAt: number } | null;

/** How often the caption re-reads the clock while she talks. Fast enough to look word-by-word,
 *  slow enough to cost nothing. */
const TICK_MS = 80;

/**
 * The part of `text` that has actually been SPOKEN by now.
 * Falls back to the whole line when there's no audio window (typed/muted mode) or once her turn
 * has ended, so a caption never freezes mid-sentence.
 */
export function useSpokenText(text: string, window: SpeechWindow, speaking: boolean): string {
  const words = useMemo(() => (text ? text.trim().split(/\s+/).filter(Boolean) : []), [text]);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!speaking || !words.length) return;
    const id = setInterval(() => tick((n) => (n + 1) % 1_000_000), TICK_MS);
    return () => clearInterval(id);
  }, [speaking, words.length]);

  if (!words.length) return '';
  if (!speaking || !window || window.endsAt <= window.startedAt) return words.join(' ');
  const span = Math.max(1, window.endsAt - window.startedAt);
  const progress = Math.min(1, Math.max(0, (Date.now() - window.startedAt) / span));
  const shown = Math.max(1, Math.ceil(progress * words.length));
  return words.slice(0, shown).join(' ');
}

/** Keep only the last `n` words — a caption line, not a paragraph. */
export function tailWords(text: string, n: number): string {
  const w = text.trim().split(/\s+/).filter(Boolean);
  return w.length <= n ? w.join(' ') : w.slice(-n).join(' ');
}
