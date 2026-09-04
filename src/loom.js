// loom.js — the weaver. Paints a loom (plain cell data) onto a p5 renderer or
// p5.Graphics, cell by cell: slit-weave gaps where colours meet, optional cicim
// relief on motif cells, and the aging pass (dye-batch drift, sun fade, wear,
// dropped knots, fraying). Every cell is an integer rectangle — the pixelation
// is the point.

import { hexToHsl, hslToHex, clampDye, lightenHex } from './palette.js';

export const cicimRelief = 0.3;   // 0–1, how proud the supplementary weft sits

const PAPER = '#ffffff';

/**
 * Compute the per-cell aging model. Returns a function cell(x, y, hex) → hex.
 * Everything seeded: patches from `rng`, per-cell drift from p5 noise seeded by `seed`.
 */
function agingModel(p, loom, rng, seed, opts) {
  p.noiseSeed(seed);
  const short = Math.min(loom.w, loom.h);
  const vertical = loom.h >= loom.w;
  // fade patches: 2–4 large, soft
  const fades = [];
  const nF = rng.int(2, 4);
  for (let i = 0; i < nF; i++) fades.push({ x: rng.range(0, loom.w), y: rng.range(0, loom.h), r: rng.range(short * 0.25, short * 0.6), a: rng.range(0.05, 0.13) });
  // wear ovals near the short edges
  const wears = [];
  const nW = rng.int(1, 3);
  for (let i = 0; i < nW; i++) {
    const nearStart = rng.chance(0.5);
    const along = nearStart ? rng.range(0.06, 0.2) : rng.range(0.8, 0.94);
    const across = rng.range(0.2, 0.8);
    const cx = vertical ? across * loom.w : along * loom.w, cy = vertical ? along * loom.h : across * loom.h;
    wears.push({ x: cx, y: cy, rx: rng.range(short * 0.12, short * 0.25), ry: rng.range(short * 0.06, short * 0.14), a: rng.range(0.10, 0.20) });
  }
  // stains: 0–2 small darker patches
  const stains = [];
  const nS = rng.int(0, 2);
  for (let i = 0; i < nS; i++) stains.push({ x: rng.range(0, loom.w), y: rng.range(0, loom.h), r: rng.range(short * 0.05, short * 0.12), a: rng.range(0.04, 0.09) });
  const dropRate = 0.0006;   // dropped knots are rare — a few per kilim, not a scatter
  const cache = new Map();

  return function cell(x, y, hex) {
    // dropped knot / warp showing through
    if (opts.drops && rng.chance(dropRate)) return opts.ivory;
    const n = p.noise(x * 0.12, y * 0.12);       // 0..1, neighbours drift together
    const n2 = p.noise(x * 0.05 + 40, y * 0.05 + 40);
    let dh = (n - 0.5) * 6, ds = (n2 - 0.5) * 8, dl = (n - 0.5) * 10;
    let lift = 0;
    for (const f of fades) { const d = Math.hypot(x - f.x, y - f.y) / f.r; if (d < 1) lift += f.a * (1 - d) * (1 - d) * 100; }
    for (const w of wears) { const d = Math.hypot((x - w.x) / w.rx, (y - w.y) / w.ry); if (d < 1) lift += w.a * (1 - d) * 100; }
    for (const s of stains) { const d = Math.hypot(x - s.x, y - s.y) / s.r; if (d < 1) dl -= s.a * (1 - d) * 100; }
    dl += lift; ds -= lift * 0.35;
    const key = hex + '|' + Math.round(dh) + '|' + Math.round(ds) + '|' + Math.round(dl);
    let out = cache.get(key);
    if (!out) {
      const [h, s, l] = hexToHsl(hex);
      out = hslToHex(clampDye([h + dh, s + ds, l + dl]));
      cache.set(key, out);
    }
    return out;
  };
}

/**
 * paintLoom(p, loom, opts)
 *   p         p5 instance or p5.Graphics
 *   loom      { w, h, colour[], motif[] }
 *   opts      { cellSize, x0, y0, seed, rng, aging (bool), weave ('slit'|'cicim'),
 *               fray (bool), paper (hex under dropped cells), ivory (hex of undyed wool) }
 */
export function paintLoom(p, loom, opts) {
  const cs = opts.cellSize, x0 = opts.x0 ?? 0, y0 = opts.y0 ?? 0;
  const aging = opts.aging && opts.rng ? agingModel(p, loom, opts.rng.fork('aging'), opts.seed ?? 1, { drops: true, ivory: opts.ivory ?? '#E8DCC4' }) : null;
  const fray = opts.fray && opts.rng ? opts.rng.fork('fray') : null;
  const relief = opts.weave === 'cicim' ? cicimRelief : 0;
  const paper = opts.paper ?? PAPER;
  const vertical = loom.h >= loom.w;
  p.noStroke();
  p.rectMode(p.CORNER);

  for (let y = 0; y < loom.h; y++) {
    for (let x = 0; x < loom.w; x++) {
      const i = y * loom.w + x;
      let v = loom.colour[i];
      const px = x0 + x * cs, py = y0 + y * cs;
      // edge fraying: outer rows lose the odd cell, mostly on the short edges
      if (fray) {
        const edgeShort = vertical ? Math.min(y, loom.h - 1 - y) : Math.min(x, loom.w - 1 - x);
        const edgeLong = vertical ? Math.min(x, loom.w - 1 - x) : Math.min(y, loom.h - 1 - y);
        const pShort = edgeShort === 0 ? 0.07 : edgeShort === 1 ? 0.015 : 0;
        const pLong = edgeLong === 0 ? 0.01 : 0;
        if (fray.chance(Math.max(pShort, pLong))) { p.fill(paper); p.rect(px, py, cs, cs); continue; }
      }
      const half = typeof v === 'object' ? v : null;
      let hex = half ? half.c : v;
      if (aging) hex = aging(x, y, hex);
      if (half) {
        // paint what lies under, then the woven triangle
        let under = typeof half.under === 'object' ? half.under.c : (half.under || opts.ivory || '#E8DCC4');
        if (aging) under = aging(x, y, under);
        p.fill(under); p.rect(px, py, cs, cs);
        p.fill(hex);
        const TL = [px, py], TR = [px + cs, py], BR = [px + cs, py + cs], BL = [px, py + cs];
        const tri = half.half === 0 ? [TR, BR, BL] : half.half === 1 ? [TL, BR, BL] : half.half === 2 ? [TL, TR, BL] : [TL, TR, BR];
        p.triangle(tri[0][0], tri[0][1], tri[1][0], tri[1][1], tri[2][0], tri[2][1]);
      } else {
        p.fill(hex); p.rect(px, py, cs, cs);
      }
      // cicim relief on motif cells: highlight top/left, shade bottom/right
      if (relief && loom.motif[i] && cs >= 4) {
        const hi = lightenHex(hex, 12 * relief * 2), lo = lightenHex(hex, -14 * relief * 2);
        p.fill(hi); p.rect(px, py, cs, 1); p.rect(px, py, 1, cs);
        p.fill(lo); p.rect(px, py + cs - 1, cs, 1); p.rect(px + cs - 1, py, 1, cs);
      }
    }
  }
  // slit-weave gaps: a 1px darker line where two colours meet along a vertical edge
  if (cs >= 4) {
    p.fill('rgba(20,20,20,0.28)');
    for (let y = 0; y < loom.h; y++) for (let x = 1; x < loom.w; x++) {
      const a = loom.colour[y * loom.w + x - 1], b = loom.colour[y * loom.w + x];
      const ca = typeof a === 'object' ? a.c : a, cb = typeof b === 'object' ? b.c : b;
      if (ca !== cb) p.rect(x0 + x * cs, y0 + y * cs, 1, cs);
    }
  }
}

/** Paint a rendered motif (from renderMotif) onto p at cell size cs over a ground colour. */
export function paintMotif(p, rendered, opts) {
  const cs = opts.cellSize, x0 = opts.x0 ?? 0, y0 = opts.y0 ?? 0;
  const h = rendered.length, w = h ? rendered[0].length : 0;
  p.noStroke();
  if (opts.ground) { p.fill(opts.ground); p.rect(x0, y0, w * cs, h * cs); }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = rendered[y][x]; if (v === null) continue;
    const px = x0 + x * cs, py = y0 + y * cs;
    if (typeof v === 'object') {
      p.fill(v.c);
      const TL = [px, py], TR = [px + cs, py], BR = [px + cs, py + cs], BL = [px, py + cs];
      const tri = v.half === 0 ? [TR, BR, BL] : v.half === 1 ? [TL, BR, BL] : v.half === 2 ? [TL, TR, BL] : [TL, TR, BR];
      p.triangle(tri[0][0], tri[0][1], tri[1][0], tri[1][1], tri[2][0], tri[2][1]);
    } else { p.fill(v); p.rect(px, py, cs, cs); }
  }
  if (opts.slits && cs >= 4) {
    p.fill('rgba(20,20,20,0.25)');
    for (let y = 0; y < h; y++) for (let x = 1; x < w; x++) {
      const a = rendered[y][x - 1], b = rendered[y][x];
      const ca = a && typeof a === 'object' ? a.c : a, cb = b && typeof b === 'object' ? b.c : b;
      if (ca !== cb) p.rect(x0 + x * cs, y0 + y * cs, 1, cs);
    }
  }
}
