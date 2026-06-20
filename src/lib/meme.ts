// Meme generation — steer the image model toward the internet-meme FORMAT (text + image), behind a
// "Meme" button in the Design center. Works for web assets AND t-shirt designs.
//
// Researched the dominant formats (Jun 2026): Drake "no/yes", Distracted Boyfriend, Two Buttons,
// Woman-Yelling-at-Cat, Surprised Pikachu, This Is Fine, Bernie "once again asking", Expanding Brain,
// Change My Mind. They differ in layout, but share ONE formatting convention that makes an image read
// as "a meme": bold ALL-CAPS condensed sans-serif (Impact), pure white with a thick black outline, as
// a top and/or bottom caption over the image. That convention is what we bake in; the user supplies
// the caption text + what the image is, and (optionally) a known layout we lay out for them.
//
// Sources:
//   https://gen-kit.com/blog/best-meme-templates-2026.html
//   https://socialbu.com/blog/popular-memes-right-now
//   https://letsmemes.com/blog/best-meme-templates

/** Wrap a creator's meme idea ("the image + the caption") in classic internet-meme formatting. */
export function buildMemePrompt(idea: string): string {
  const body = idea.trim().replace(/[.\s]+$/, '');
  return (
    `Create a funny internet MEME image. ${body}. ` +
    `Use classic meme formatting: render ALL caption text in bold ALL-CAPS condensed sans-serif ` +
    `(Impact font), pure white letters with a thick solid black outline — as a top caption and/or a ` +
    `bottom caption as described, large and centered, inset just enough that the text isn't clipped. ` +
    `Spell every word correctly and keep the text fully legible and unobstructed. ` +
    `If the idea names or implies a known layout (top/bottom caption, a two-panel "this vs that" or ` +
    `Drake-style approve/reject, a side-by-side reaction, or labeled characters), compose it that way. ` +
    `CRITICAL: the meme must FILL THE ENTIRE FRAME edge to edge — the photo/background reaches all four ` +
    `edges of the image with NO white border, no frame, and no margin or padding around the meme. ` +
    `Bold, high-contrast, genuinely shareable; the subject stays clearly visible behind the text.`
  );
}

/** Placeholder that teaches the meme input format (image + caption). */
export const MEME_PLACEHOLDER =
  'Describe the meme — the image + the caption. e.g. “a cat glaring at a laptop · top: WHEN THE CODE WORKS · bottom: BUT YOU DON’T KNOW WHY”';

/** A few popular layouts a creator can name in their description (Venus/UI hint; not required). */
export const MEME_FORMATS = [
  'Top & bottom caption (classic)',
  'Drake — reject this / approve that',
  'Two buttons — hard choice',
  'This vs that — side by side',
  'Change my mind',
  'Expanding brain — escalating ideas',
] as const;
