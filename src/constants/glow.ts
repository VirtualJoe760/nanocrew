import { Platform } from 'react-native';

// "Nano glow" — the brand's depth language. A soft, colored halo (a shadow with no offset) that lifts
// logos, buttons, cards, and key text off the dark background. iOS renders it around an image's alpha
// shape (so it traces the logo, not a box); react-native-web maps it to box-shadow; Android can't do a
// colored glow, so it falls back to a faint neutral elevation. Reuse these instead of hand-rolling
// shadows — one depth system, applied everywhere. Palette accents (platinum silver) are the usual color.

/** A halo around a view (logo, button, card, focused input). */
export function glow(color: string, radius = 14, opacity = 0.55) {
  return {
    shadowColor: color,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: opacity,
    shadowRadius: radius,
    ...(Platform.OS === 'android' ? { elevation: Math.max(2, Math.round(radius / 2)) } : null),
  } as const;
}

/** A glow behind text so it pops instead of sitting grey-on-grey. */
export function textGlow(color: string, radius = 10) {
  return {
    textShadowColor: color,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: radius,
  } as const;
}
