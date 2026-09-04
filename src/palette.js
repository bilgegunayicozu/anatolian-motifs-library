// palette.js — natural-dye colour logic: dye lookup, HSL maths, aging jitter,
// and the regional palette pick the generator uses.
// Constraint (CLAUDE.md §3.5): no pure black/white for woven colours, no HSL saturation > 65%.

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToHex([r, g, b]) {
  const c = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}
export function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h *= 60;
  }
  return [h, s * 100, l * 100];
}
export function hslToRgb([h, s, l]) {
  h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  let rgb;
  if (h < 60) rgb = [c, x, 0]; else if (h < 120) rgb = [x, c, 0]; else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c]; else if (h < 300) rgb = [x, 0, c]; else rgb = [c, 0, x];
  return rgb.map(v => (v + m) * 255);
}
export const hexToHsl = hex => rgbToHsl(hexToRgb(hex));
export const hslToHex = hsl => rgbToHex(hslToRgb(hsl));

/** Clamp to the dye rule: saturation ≤ 65, lightness kept off the pure ends. */
export function clampDye(hsl) {
  return [hsl[0], Math.min(65, Math.max(0, hsl[1])), Math.min(94, Math.max(6, hsl[2]))];
}

/** Perturb a hex colour by (dh, ds, dl) in HSL units. */
export function jitterHex(hex, dh = 0, ds = 0, dl = 0) {
  const [h, s, l] = hexToHsl(hex);
  return hslToHex(clampDye([h + dh, s + ds, l + dl]));
}
export function lightenHex(hex, amount) { return jitterHex(hex, 0, -amount * 0.4, amount); }

/** Perceived luminance 0–1 (for ground/figure contrast decisions). */
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(v => v / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const GROUND_LIGHTS = new Set(['ivory_wool', 'oatmeal', 'henna_pale']);

/**
 * Pick a working palette for a region.
 * Returns { ground, groundKey, colours:[hex], keys:[dye keys], primary, secondary, border, guard, wall }
 * — the dominant ground plus 4–6 figure colours, ordered by contrast against the ground.
 */
export function regionPalette(region, dyes, rng) {
  const keys = region.palette.slice();
  const hex = k => dyes[k].hex;

  // Ground: light regions weave on undyed wool; dark regions on madder / indigo / aubergine.
  const lights = keys.filter(k => GROUND_LIGHTS.has(k));
  let groundKey;
  if (lights.length && rng.chance(0.7)) groundKey = rng.pick(lights);
  else groundKey = rng.pick(keys.filter(k => !GROUND_LIGHTS.has(k)));

  // Figure colours: everything else, 4–6 of them, shuffled but sorted by contrast.
  const others = rng.shuffle(keys.filter(k => k !== groundKey));
  const n = Math.min(others.length, rng.int(4, 6));
  const chosen = others.slice(0, n);
  const gl = luminance(hex(groundKey));
  chosen.sort((a, b) => Math.abs(luminance(hex(b)) - gl) - Math.abs(luminance(hex(a)) - gl));

  const colours = chosen.map(hex);
  // If ground is light, a light figure colour would vanish — keep it only as accent.
  const strong = chosen.filter(k => Math.abs(luminance(hex(k)) - gl) > 0.18);
  const primaryKey = strong[0] || chosen[0];
  const secondaryKey = strong[1] || chosen[1] || chosen[0];
  return {
    ground: hex(groundKey), groundKey,
    keys: chosen, colours,
    primary: hex(primaryKey), primaryKey,
    secondary: hex(secondaryKey), secondaryKey,
    border: hex(strong[1] || strong[0] || chosen[0]),
    guard: hex(chosen[chosen.length - 1]),
    wall: hex(strong[0] || chosen[0]),
    all: keys.map(hex),
  };
}

/** A palette for a motif swatch shown "as region X would dye it" — no ground jitter, just its dyes. */
export function swatchPalette(region, dyes, rng) {
  const p = regionPalette(region, dyes, rng);
  return { ground: p.ground, primary: p.primary, secondary: p.secondary };
}
