// What to CALL the thing a design is going on (Joe, field test 2026-08-19: the CTA read "Put it
// on the All shirt"). Two different jobs, both client-safe so either design surface can use them:
//
//   blankLabel('Unisex Basic Hoodie | Printstar 00216-MLH')  → 'Unisex Basic Hoodie'
//   garmentNoun('Unisex Basic Hoodie | Printstar 00216-MLH') → 'hoodie'
//
// NEVER derive a noun from CatalogBlank.type — that field is the Printful *category*
// ("All shirts", "All hats", "Bags"), which is why singularising it produced "All shirt".

/** The product name without its supplier/SKU suffix. */
export function blankLabel(name: string | null | undefined): string {
  return (name ?? '').split('|')[0].trim();
}

// Longest / most specific first — "crew neck t-shirt" must match tee, not crewneck; "tank top"
// must beat "top". Each entry is [needle, spoken noun].
const NOUNS: [RegExp, string][] = [
  [/\bt[-\s]?shirt\b|\btee\b/i, 'tee'],
  [/\btank\b/i, 'tank'],
  [/\bpolo\b/i, 'polo'],
  [/\bhoodie\b|\bhooded\b/i, 'hoodie'],
  [/\bcrew\s?neck\b|\bcrewneck\b/i, 'crewneck'],
  [/\bsweatshirt\b/i, 'sweatshirt'],
  [/\bsweatpants\b|\bjoggers\b|\btrack pants\b/i, 'joggers'],
  [/\bleggings\b/i, 'leggings'],
  [/\bshorts\b/i, 'shorts'],
  [/\bpants\b/i, 'pants'],
  [/\bdress\b/i, 'dress'],
  [/\bskirt\b/i, 'skirt'],
  [/\bbodysuit\b|\bonesie\b/i, 'bodysuit'],
  [/\bjacket\b|\bbomber\b|\bwindbreaker\b/i, 'jacket'],
  [/\bvest\b/i, 'vest'],
  [/\bbeanie\b/i, 'beanie'],
  [/\bvisor\b/i, 'visor'],
  [/\bcap\b|\bhat\b/i, 'cap'],
  [/\btote\b/i, 'tote'],
  [/\bbackpack\b/i, 'backpack'],
  [/\bfanny pack\b|\bbelt bag\b/i, 'belt bag'],
  [/\bduffle\b|\bduffel\b/i, 'duffle'],
  [/\bbag\b/i, 'bag'],
  [/\bsocks\b/i, 'socks'],
  [/\bapron\b/i, 'apron'],
  [/\bmug\b/i, 'mug'],
  [/\btumbler\b|\bbottle\b/i, 'bottle'],
  [/\bblanket\b/i, 'blanket'],
  [/\btowel\b/i, 'towel'],
  [/\bpillow\b|\bcushion\b/i, 'pillow'],
  [/\brug\b|\bmat\b/i, 'rug'],
  [/\bposter\b/i, 'poster'],
  [/\bcanvas\b/i, 'canvas'],
  [/\bsticker\b|\bdecal\b/i, 'sticker'],
  [/\bpatch(es)?\b/i, 'patch'],
  [/\bphone case\b|\bcase\b/i, 'case'],
  [/\bcrop top\b/i, 'crop top'],
  [/\bsports bra\b|\bbralette\b/i, 'sports bra'],
  [/\bboxer briefs\b|\bbriefs\b|\bboxers\b/i, 'boxers'],
  [/\bbutton shirt\b|\bbutton[-\s]?up\b|\bbutton[-\s]?down\b/i, 'button shirt'],
  [/\bjersey\b/i, 'jersey'],
  [/\brash guard\b/i, 'rash guard'],
  [/\bswimsuit\b|\bswim trunks\b|\bbikini\b/i, 'swimsuit'],
  [/\bbandana\b/i, 'bandana'],
  [/\bheadband\b/i, 'headband'],
  [/\bgaiter\b/i, 'gaiter'],
  [/\bpullover\b|\bquarter[-\s]?zip\b/i, 'pullover'],
  [/\bflag\b/i, 'flag'],
  [/\bornaments?\b/i, 'ornament'],
  [/\bcoaster\b/i, 'coaster'],
  [/\bmouse\s?pad\b|\bmousepad\b/i, 'mousepad'],
  [/\bpuzzle\b/i, 'puzzle'],
  [/\bnotebook\b|\bjournal\b/i, 'notebook'],
  [/\bkeychain\b|\bkey ring\b/i, 'keychain'],
  [/\bmagnet\b/i, 'magnet'],
  [/\btapestry\b/i, 'tapestry'],
  [/\bshower curtain\b/i, 'shower curtain'],
  [/\bluggage tag\b|\btag\b/i, 'luggage tag'],
];

/** A short, speakable noun for the product ("hoodie", "cap", "tote"). Falls back to the
 *  supplier-stripped product name, and only then to a generic word. */
export function garmentNoun(name: string | null | undefined): string {
  const label = blankLabel(name);
  if (!label) return 'product';
  for (const [re, noun] of NOUNS) if (re.test(label)) return noun;
  return label.toLowerCase();
}
