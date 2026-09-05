// composition.js — turns a composition zone-map (data/compositions.json) into a
// woven loom: borders, guard stripes, niches, bands, compartments, medallions, and
// motif placements. Each zone character has a rule; the coarse map is scaled onto
// the loom and refined where a coarse block would look wrong (niche arches are
// interpolated into stepped outlines; medallions are re-rasterised as diamonds).
//
// Three rules keep a specimen looking woven rather than scattered:
//   1. SYMMETRY. Everything is mirrored left↔right, and the border ring and every
//      non-directional field are mirrored top↔bottom as well, so the four corners
//      always resolve identically (mirrorLoom, at the end of weaveComposition).
//   2. CONTRAST. A motif colour is never chosen against a nominal ground — it is
//      chosen against the colour actually under the motif, and must clear a
//      minimum luminance distance or the palette's extremes are used instead
//      (bgAt + pickFigure). A motif is never woven in its own background colour.
//   3. THE GRID. Repeats are counted to fit, then centred, so margins are equal on
//      both sides; a half-drop row carries one fewer motif so it stays centred too.
//
// The loom it returns is plain data: { w, h, colour[], motif[] } plus placements.
// Nothing here draws; loom.js paints it.

import { renderMotif, stamp, scalePattern, rotate90, flipV, flipH } from './motif.js';
import { luminance } from './palette.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const INTERIOR = new Set(['N', 'k', 'm']);
const BORDER_MOTIFS = ['cengel', 'suyolu', 'goz', 'kurtagzi', 'disli-baklava', 'muska', 'pitrak'];

// Compositions whose field reads the same upside down, so it may be mirrored top↔bottom.
// The rest are directional (a prayer niche points one way) and are mirrored left↔right only.
const V_SYMMETRIC = new Set(['tumzemin', 'khesti', 'madalyonlu', 'bandli', 'aynali', 'bos-gobek', 'cift-mihrab']);

/** Minimum luminance distance for a motif to read against its ground. */
const MIN_CONTRAST = 0.20;

/**
 * Pick the colour a motif should be woven in, given what is actually behind it.
 * Candidates are ranked by luminance distance; anything below MIN_CONTRAST is
 * rejected, and if the whole palette fails we reach for the region's extreme dyes
 * rather than weave a motif in its own background colour.
 */
function pickFigure(bg, candidates, fallbacks = []) {
  const lb = luminance(bg);
  const rank = list => list.filter(c => c && c !== bg)
    .sort((a, b) => Math.abs(luminance(b) - lb) - Math.abs(luminance(a) - lb));
  const ranked = rank(candidates);
  const good = ranked.filter(c => Math.abs(luminance(c) - lb) >= MIN_CONTRAST);
  if (good.length) return good[0];
  const spare = rank(fallbacks).filter(c => Math.abs(luminance(c) - lb) >= MIN_CONTRAST);
  return spare[0] || ranked[0] || fallbacks[0] || bg;
}
/** Most contrasting colour against `bg`, no threshold — for structural bands. */
function contrastTo(bg, colours) {
  const lb = luminance(bg);
  return colours.filter(c => c && c !== bg)
    .sort((a, b) => Math.abs(luminance(b) - lb) - Math.abs(luminance(a) - lb))[0];
}

/** Fill a rectangle of the loom with a colour (and clear motif marks). */
function fillRect(loom, x0, y0, w, h, colour) {
  for (let y = Math.max(0, y0); y < Math.min(loom.h, y0 + h); y++)
    for (let x = Math.max(0, x0); x < Math.min(loom.w, x0 + w); x++) {
      loom.colour[y * loom.w + x] = colour; loom.motif[y * loom.w + x] = 0;
    }
}
function fillCell(loom, x, y, colour) {
  if (x < 0 || y < 0 || x >= loom.w || y >= loom.h) return;
  loom.colour[y * loom.w + x] = colour; loom.motif[y * loom.w + x] = 0;
}
/**
 * The ground colour at (x, y) — the colour of the woven structure, read from the
 * snapshot taken before any motif was stamped. Sampling the live loom instead would
 * let one motif read its neighbour's threads as "background" and pick a colour that
 * vanishes into the field.
 */
function bgAt(ctx, x, y) {
  const loom = ctx.loom;
  const cx = clamp(Math.round(x), 0, loom.w - 1), cy = clamp(Math.round(y), 0, loom.h - 1);
  const src = ctx.baseColour || loom.colour;
  const v = src[cy * loom.w + cx];
  return typeof v === 'object' ? v.c : v;
}

/** 4-connected components of cells whose char is in `chars` on a small char grid. */
function components(rows, chars) {
  const H = rows.length, W = rows[0].length, seen = new Set(), out = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = y * W + x;
    if (seen.has(k) || !chars.has(rows[y][x])) continue;
    const ch = rows[y][x], stack = [k], cells = [];
    seen.add(k);
    while (stack.length) {
      const c = stack.pop(); const cy = Math.floor(c / W), cx = c % W; cells.push([cx, cy]);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy, nk = ny * W + nx;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen.has(nk) || rows[ny][nx] !== ch) continue;
        seen.add(nk); stack.push(nk);
      }
    }
    const xs = cells.map(c => c[0]), ys = cells.map(c => c[1]);
    out.push({ ch, x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys), n: cells.length });
  }
  return out;
}

/** Runs of chars (from a set) along one row → [{l, r}] in zone columns. */
function runs(row, set) {
  const out = []; let l = -1;
  for (let x = 0; x <= row.length; x++) {
    const inRun = x < row.length && set.has(row[x]);
    if (inRun && l < 0) l = x;
    if (!inRun && l >= 0) { out.push({ l, r: x - 1 }); l = -1; }
  }
  return out;
}

/**
 * Lay out a run of `count` repeats across `span`, centred on the loom's mirror axis.
 * The gap is nudged by a cell where needed so the run's length has the same parity as
 * the loom: otherwise the axis falls inside a repeat and the left↔right reflection
 * shaves a column off it. Falls back to centring within the span for off-axis strips.
 */
function centreRun(loomLen, patLen, gap, span, start) {
  const centred = Math.abs((start + span / 2) - loomLen / 2) < 1.5;
  if (centred) {
    for (const g of [gap, gap + 1, gap - 1, gap + 2]) {
      if (g < 0) continue;
      const step = patLen + g;
      const n = Math.floor((span + g) / step);
      if (n < 1) continue;
      const used = n * step - g;
      if (used > span || (loomLen - used) % 2 !== 0) continue;
      return { n, step, s: Math.round((loomLen - used) / 2) };
    }
  }
  const step = patLen + gap;
  const n = Math.floor((span + gap) / step);
  if (n < 1) return { n: 0, step, s: start };
  return { n, step, s: start + Math.floor((span - (n * step - gap)) / 2) };
}

/**
 * Place a motif centred in a loom-cell box, scaled by an integer factor so it fills
 * `fill` of the box (never larger than the box). A box that is itself centred on the
 * loom snaps the motif exactly onto the mirror axis. Colours are resolved against what
 * is actually woven at the centre of the box. Returns the placement record.
 */
function placeIn(ctx, motifKey, bx, by, bw, bh, fill, colours, opts = {}) {
  const pat0 = ctx.patterns[motifKey]; if (!pat0) return null;
  let k = Math.floor(Math.min((bw * fill) / pat0.w, (bh * fill) / pat0.h));
  k = clamp(k, 1, opts.maxScale ?? 6);
  let pat = scalePattern(pat0, k);
  if (opts.flipV) pat = flipV(pat);
  if (pat.w > bw + 2 || pat.h > bh + 2) return null;      // does not fit even at 1×
  let x = Math.round(bx + (bw - pat.w) / 2), y = Math.round(by + (bh - pat.h) / 2);
  // snap a box that straddles the loom's axis onto it, so the reflection lands on itself
  if (Math.abs((bx + bw / 2) - ctx.loom.w / 2) < 1.5) x = Math.round((ctx.loom.w - pat.w) / 2);
  if (ctx.verticalSym && Math.abs((by + bh / 2) - ctx.loom.h / 2) < 1.5) y = Math.round((ctx.loom.h - pat.h) / 2);
  // never weave a motif in the colour it sits on
  const under = bgAt(ctx, x + pat.w / 2, y + pat.h / 2);
  const reads = c => c && c !== under && Math.abs(luminance(c) - luminance(under)) >= MIN_CONTRAST;
  const primary = reads(colours.primary) ? colours.primary : pickFigure(under, ctx.figure, ctx.palette.all);
  const secondary = reads(colours.secondary) && colours.secondary !== primary
    ? colours.secondary
    : pickFigure(under, ctx.figure.filter(c => c !== primary), ctx.palette.all.filter(c => c !== primary)) || primary;
  const rendered = renderMotif(pat, primary, secondary);
  const index = ctx.placements.length + 1;
  stamp(ctx.loom, rendered, x, y, index);
  const rec = { index, key: motifKey, x, y, w: pat.w, h: pat.h, scale: k, primary, secondary };
  ctx.placements.push(rec);
  return rec;
}

/** Tile a motif along a horizontal strip (y0..y0+h), counted to fit then centred. */
function tileRow(ctx, motifKey, x0, y0, w, h, colours, gap = 1, rotate = false, scaleTo = null) {
  let pat = ctx.patterns[motifKey]; if (!pat) return 0;
  if (rotate) pat = rotate90(pat);
  const fitH = scaleTo ?? h;
  const k = clamp(Math.floor((fitH - 1) / pat.h), 1, 4);
  pat = scalePattern(pat, k);
  if (pat.h > h || w < pat.w) return 0;
  const { n, step, s: sx } = centreRun(ctx.loom.w, pat.w, gap, w, x0);
  if (n < 1) return 0;
  const y = y0 + Math.floor((h - pat.h) / 2);
  const under = bgAt(ctx, sx + pat.w / 2, y + pat.h / 2);
  const reads = c => c && c !== under && Math.abs(luminance(c) - luminance(under)) >= MIN_CONTRAST;
  const primary = reads(colours.primary) ? colours.primary : pickFigure(under, ctx.figure, ctx.palette.all);
  const secondary = reads(colours.secondary) ? colours.secondary : primary;
  const rendered = renderMotif(pat, primary, secondary);
  for (let i = 0; i < n; i++) {
    const index = ctx.placements.length + 1;
    const x = sx + i * step;
    stamp(ctx.loom, rendered, x, y, index);
    ctx.placements.push({ index, key: motifKey, x, y, w: pat.w, h: pat.h, scale: k, primary, secondary, border: !!ctx.inBorder });
  }
  return n;
}
/** Tile a motif along a vertical strip (rotated 90°), counted to fit then centred. */
function tileCol(ctx, motifKey, x0, y0, w, h, colours, gap = 1) {
  let pat = ctx.patterns[motifKey]; if (!pat) return 0;
  pat = rotate90(pat);
  const k = clamp(Math.floor((w - 1) / pat.w), 1, 4);
  pat = scalePattern(pat, k);
  if (pat.w > w || h < pat.h) return 0;
  const { n, step, s: sy } = centreRun(ctx.loom.h, pat.h, gap, h, y0);
  if (n < 1) return 0;
  const x = x0 + Math.floor((w - pat.w) / 2);
  const under = bgAt(ctx, x + pat.w / 2, sy + pat.h / 2);
  const reads = c => c && c !== under && Math.abs(luminance(c) - luminance(under)) >= MIN_CONTRAST;
  const primary = reads(colours.primary) ? colours.primary : pickFigure(under, ctx.figure, ctx.palette.all);
  const secondary = reads(colours.secondary) ? colours.secondary : primary;
  const rendered = renderMotif(pat, primary, secondary);
  for (let i = 0; i < n; i++) {
    const index = ctx.placements.length + 1, y = sy + i * step;
    stamp(ctx.loom, rendered, x, y, index);
    ctx.placements.push({ index, key: motifKey, x, y, w: pat.w, h: pat.h, scale: k, primary, secondary, border: true });
  }
  return n;
}

/** Rasterise a stepped diamond in a box, filled or as an outline of `outline` cells. */
function diamond(loom, bx, by, bw, bh, colour, outline = 0) {
  const cx = bx + bw / 2, cy = by + bh / 2, rx = bw / 2, ry = bh / 2;
  for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) {
    if (x < 0 || y < 0 || x >= loom.w || y >= loom.h) continue;
    const d = Math.abs(x + 0.5 - cx) / rx + Math.abs(y + 0.5 - cy) / ry;
    const inner = outline ? (Math.abs(x + 0.5 - cx) / (rx - outline) + Math.abs(y + 0.5 - cy) / (ry - outline)) : 0;
    if (d <= 1 && (!outline || inner > 1)) { loom.colour[y * loom.w + x] = colour; loom.motif[y * loom.w + x] = 0; }
  }
}

/* ------------------------------------------------------------------ borders */
/**
 * Concentric border bands. Each band reserves a square block at each of the four
 * corners so the horizontal and vertical runs never collide there; the corner
 * carries its own small diamond, the way a weaver resolves a corner. The runs
 * themselves are counted to fit and centred; mirrorLoom then makes the four
 * corners and both pairs of edges identical.
 */
function weaveBorders(ctx) {
  const { loom, rng, palette, pool } = ctx;
  const W = loom.w, H = loom.h;
  const short = Math.min(W, H);
  const bT = clamp(Math.round(short * 0.075), 6, 11);
  const gT = clamp(Math.round(short * 0.025), 2, 3);
  const bands = short >= 84 && rng.chance(0.5) ? 2 : 1;

  let inset = 0;
  const borderKeys = pool.filter(k => BORDER_MOTIFS.includes(k));
  const fallback = ['cengel', 'suyolu', 'goz'].filter(k => ctx.patterns[k]);
  const choices = borderKeys.length ? borderKeys : fallback;
  ctx.inBorder = true;

  for (let b = 0; b < bands; b++) {
    const thick = b === 0 ? bT : Math.max(5, Math.round(bT * 0.7));
    const ground = b === 0 ? palette.border : (rng.chance(0.5) ? palette.ground : palette.guard);
    const fig = pickFigure(ground, palette.colours.concat([palette.ground]), palette.all);
    const fig2 = pickFigure(ground, palette.colours.filter(c => c !== fig), palette.all.filter(c => c !== fig)) || fig;

    // the band's ground ring
    fillRect(loom, inset, inset, W - 2 * inset, thick, ground);
    fillRect(loom, inset, H - inset - thick, W - 2 * inset, thick, ground);
    fillRect(loom, inset, inset, thick, H - 2 * inset, ground);
    fillRect(loom, W - inset - thick, inset, thick, H - 2 * inset, ground);

    const key = rng.pick(choices);
    const colours = { primary: fig, secondary: fig2 };
    const gap = rng.int(1, 2);
    const c0 = inset + thick;                   // where the corner blocks end
    const spanW = W - 2 * c0, spanH = H - 2 * c0;
    // runs between the corner blocks only — the corners are resolved separately
    tileRow(ctx, key, c0, inset, spanW, thick, colours, gap);
    tileRow(ctx, key, c0, H - inset - thick, spanW, thick, colours, gap);
    tileCol(ctx, key, inset, c0, thick, spanH, colours, gap);
    tileCol(ctx, key, W - inset - thick, c0, thick, spanH, colours, gap);
    // corner resolution: a centred diamond in each corner block
    const cd = Math.max(3, thick - 2);
    for (const [cx, cy] of [[inset, inset], [W - inset - thick, inset],
                            [inset, H - inset - thick], [W - inset - thick, H - inset - thick]]) {
      diamond(loom, cx + Math.floor((thick - cd) / 2), cy + Math.floor((thick - cd) / 2), cd, cd, fig);
    }
    inset += thick;

    // guard stripe: a plain line with reciprocal teeth on its inner edge, phased
    // from the loom centre so both ends of every run finish the same way
    const gA = pickFigure(ground, [palette.guard, palette.ground, ...palette.colours], palette.all);
    const gB = pickFigure(gA, palette.colours.concat([palette.ground]), palette.all);
    fillRect(loom, inset, inset, W - 2 * inset, gT, gA);
    fillRect(loom, inset, H - inset - gT, W - 2 * inset, gT, gA);
    fillRect(loom, inset, inset, gT, H - 2 * inset, gA);
    fillRect(loom, W - inset - gT, inset, gT, H - 2 * inset, gA);
    if (gT >= 2) {
      const mx = Math.floor(W / 2), my = Math.floor(H / 2);
      for (let x = inset; x < W - inset; x++) if (Math.abs(x - mx) % 2 === 0) {
        fillCell(loom, x, inset + gT - 1, gB); fillCell(loom, x, H - inset - gT, gB);
      }
      for (let y = inset; y < H - inset; y++) if (Math.abs(y - my) % 2 === 0) {
        fillCell(loom, inset + gT - 1, y, gB); fillCell(loom, W - inset - gT, y, gB);
      }
    }
    inset += gT;
  }
  ctx.inBorder = false;
  ctx.borderCells = inset;
  return { x: inset, y: inset, w: W - 2 * inset, h: H - 2 * inset };
}

/* ------------------------------------------------------------------ niches */
/**
 * Refine niche rows: interpolate the interior spans of N/k/m runs across loom rows so
 * arches step smoothly, then paint interior / wall / spandrel with a fixed wall thickness.
 */
function weaveNiches(ctx, F, inner, colours) {
  const { loom } = ctx;
  const rows = inner.length, cols = inner[0].length;
  const rowHasNiche = inner.map(r => r.includes('A') || r.includes('a'));
  if (!rowHasNiche.some(Boolean)) return;
  const wallT = clamp(Math.round(F.w * 0.025), 2, 4);
  const toX = c => F.x + Math.round(c * F.w / cols);
  const toY = r => F.y + Math.round(r * F.h / rows);

  const keys = [];
  for (let r = 0; r < rows; r++) {
    if (!rowHasNiche[r]) continue;
    const row = inner[r];
    const interior = runs(row, INTERIOR).map(s => ({ l: toX(s.l), r: toX(s.r + 1) - 1 }));
    const apex = runs(row, new Set(['a']));
    if (apex.length && !interior.length) {
      const pointsUp = !(r > 0 && INTERIOR.has(inner[r - 1][Math.floor((apex[0].l + apex[0].r) / 2)]));
      const below = pointsUp ? inner[r + 1] : inner[r - 1];
      const spans = apex.map(a => {
        const cx = Math.floor((a.l + a.r) / 2);
        const nb = below ? runs(below, INTERIOR).find(s => s.l <= a.r && s.r >= a.l) : null;
        const open = nb ? { l: toX(nb.l), r: toX(nb.r + 1) - 1 } : { l: toX(a.l), r: toX(a.r + 1) - 1 };
        const tip = { l: toX(cx) + Math.floor((toX(cx + 1) - toX(cx)) / 2) - 1, r: toX(cx) + Math.floor((toX(cx + 1) - toX(cx)) / 2) };
        return { open, tip };
      });
      if (pointsUp) {
        keys.push({ y: toY(r), spans: spans.map(s => s.tip), apex: true });
        keys.push({ y: toY(r + 1) - 1, spans: spans.map(s => s.open) });
      } else {
        keys.push({ y: toY(r), spans: spans.map(s => s.open) });
        keys.push({ y: toY(r + 1) - 1, spans: spans.map(s => s.tip), apex: true });
      }
    } else if (interior.length) {
      keys.push({ y: Math.round((toY(r) + toY(r + 1)) / 2) - 1, spans: interior });
    } else {
      keys.push({ y: toY(r), spans: [], wallLine: true, y1: toY(r + 1) });
    }
  }
  keys.sort((a, b) => a.y - b.y);

  const spansAt = (y) => {
    let prev = null, next = null;
    for (const k of keys) { if (k.y <= y) prev = k; else { next = k; break; } }
    if (!prev) return null;
    if (prev.wallLine) return { wall: true, y1: prev.y1 };
    if (!next || next.wallLine || next.spans.length !== prev.spans.length) return { spans: prev.spans };
    const t = (y - prev.y) / Math.max(1, next.y - prev.y);
    return { spans: prev.spans.map((s, i) => ({ l: Math.round(s.l + (next.spans[i].l - s.l) * t), r: Math.round(s.r + (next.spans[i].r - s.r) * t) })) };
  };

  for (let r = 0; r < rows; r++) {
    if (!rowHasNiche[r]) continue;
    for (let y = toY(r); y < toY(r + 1); y++) {
      const s = spansAt(y);
      if (!s) { for (let x = F.x; x < F.x + F.w; x++) fillCell(loom, x, y, colours.spandrel); continue; }
      if (s.wall) {
        const c = (y - (keys.find(k => k.wallLine && k.y <= y && y < k.y1)?.y ?? 0)) < wallT ? colours.wall : colours.spandrel;
        for (let x = F.x; x < F.x + F.w; x++) fillCell(loom, x, y, c);
        continue;
      }
      for (let x = F.x; x < F.x + F.w; x++) {
        let paint = colours.spandrel;
        for (const sp of s.spans) {
          if (x >= sp.l && x <= sp.r) { paint = colours.ground; break; }
          if (x >= sp.l - wallT && x <= sp.r + wallT) { paint = colours.wall; }
        }
        fillCell(loom, x, y, paint);
      }
    }
  }
}

/* ---------------------------------------------------------------- the field */
export function weaveField(ctx, F, comp) {
  const { loom, rng, palette, pool } = ctx;
  const zones = comp.zones;
  // strip the map's own B and g rings — we wove real borders already
  const inner = zones.slice(2, -2).map(r => r.slice(2, -2));
  const rows = inner.length, cols = inner[0].length;
  const zx = x => clamp(Math.floor((x - F.x) * cols / F.w), 0, cols - 1);
  const zy = y => clamp(Math.floor((y - F.y) * rows / F.h), 0, rows - 1);
  const toX = c => F.x + Math.round(c * F.w / cols);
  const toY = r => F.y + Math.round(r * F.h / rows);
  // '.' is a spandrel only where there is an arch to sit beside; in a lattice or a
  // banded field it is simply open ground (this is what used to produce a spurious
  // chequerboard behind the all-over lattice).
  const hasNiche = inner.some(r => r.includes('A') || r.includes('a'));

  const figure = palette.colours.filter(c => c !== palette.ground);
  ctx.figure = figure;
  const colours = {
    ground: palette.ground,
    wall: palette.wall,
    spandrel: pickFigure(palette.ground, figure.filter(c => c !== palette.wall), palette.all) || palette.secondary,
    panel: pickFigure(palette.ground, figure, palette.all) || palette.secondary,
    medallion: palette.primary,
    compartmentWall: palette.wall,
  };
  /** Motif colours for a nominal ground; placeIn re-checks against the real cell. */
  const motifColours = (bg) => {
    const p = pickFigure(bg, figure.concat([palette.ground]), palette.all);
    const s = pickFigure(bg, figure.concat([palette.ground]).filter(c => c !== p), palette.all.filter(c => c !== p)) || p;
    return { primary: p, secondary: s };
  };

  // 1. base paint from the zone characters
  for (let y = F.y; y < F.y + F.h; y++) for (let x = F.x; x < F.x + F.w; x++) {
    const ch = inner[zy(y)][zx(x)];
    let c = colours.ground;
    if (ch === 'A' || ch === 'a') c = colours.wall;
    else if (ch === '.') c = hasNiche ? colours.spandrel : colours.ground;
    else if (ch === 'T' || ch === 'L' || ch === 'D') c = colours.panel;
    else if (ch === 'M' || ch === 'O') c = colours.ground;
    else if (ch === '|' || ch === '-') c = colours.compartmentWall;
    fillCell(loom, x, y, c);
  }

  // 2. niches: interpolate arches
  weaveNiches(ctx, F, inner, colours);

  // 3. compartment walls as 2-cell lines
  const wallW = 2;
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
    const ch = inner[r][c];
    if (ch === '|') {
      const x = Math.round((toX(c) + toX(c + 1)) / 2) - 1;
      fillRect(loom, toX(c), toY(r), toX(c + 1) - toX(c), toY(r + 1) - toY(r), colours.ground);
      fillRect(loom, x, toY(r), wallW, toY(r + 1) - toY(r), colours.compartmentWall);
    }
    if (ch === '-') {
      const y = Math.round((toY(r) + toY(r + 1)) / 2) - 1;
      fillRect(loom, toX(c), toY(r), toX(c + 1) - toX(c), toY(r + 1) - toY(r), colours.ground);
      fillRect(loom, toX(c), y, toX(c + 1) - toX(c), wallW, colours.compartmentWall);
    }
  }

  // 4. medallions: re-rasterise M and O components as diamonds
  for (const comp_ of components(inner, new Set(['M']))) {
    const bx = toX(comp_.x0), by = toY(comp_.y0), bw = toX(comp_.x1 + 1) - bx, bh = toY(comp_.y1 + 1) - by;
    if (comp.key === 'aynali') { fillRect(loom, bx, by, bw, bh, colours.wall); continue; }  // the mirror axis
    fillRect(loom, bx, by, bw, bh, colours.ground);
    diamond(loom, bx, by, bw, bh, colours.medallion);
    const innerC = pickFigure(colours.medallion, figure.concat([palette.ground]), palette.all);
    diamond(loom, bx + Math.round(bw * 0.12), by + Math.round(bh * 0.12), Math.round(bw * 0.76), Math.round(bh * 0.76), innerC);
    const core = { primary: pickFigure(innerC, figure.concat([palette.ground]), palette.all), secondary: colours.medallion };
    const key = pool.includes('basamakli-gobek') ? 'basamakli-gobek' : (pool.find(k => ['hac', 'goz', 'yildiz', 'disli-baklava'].includes(k)) || pool[0]);
    placeIn(ctx, key, bx, by, bw, bh, 0.72, core);
    // quarter medallions in the field corners (Uşak / Kars habit) — all four or none
    if (rng.chance(0.6)) {
      const qw = Math.round(bw * 0.45), qh = Math.round(bh * 0.45);
      const corners = [[F.x - Math.round(qw / 2), F.y - Math.round(qh / 2)], [F.x + F.w - Math.round(qw / 2), F.y - Math.round(qh / 2)],
                       [F.x - Math.round(qw / 2), F.y + F.h - Math.round(qh / 2)], [F.x + F.w - Math.round(qw / 2), F.y + F.h - Math.round(qh / 2)]];
      for (const [cx, cy] of corners) {
        for (let y = Math.max(F.y, cy); y < Math.min(F.y + F.h, cy + qh); y++) for (let x = Math.max(F.x, cx); x < Math.min(F.x + F.w, cx + qw); x++) {
          const d = Math.abs(x + 0.5 - (cx + qw / 2)) / (qw / 2) + Math.abs(y + 0.5 - (cy + qh / 2)) / (qh / 2);
          if (d <= 1) fillCell(loom, x, y, colours.medallion);
        }
      }
    }
  }
  for (const comp_ of components(inner, new Set(['O']))) {
    const bx = toX(comp_.x0), by = toY(comp_.y0), bw = toX(comp_.x1 + 1) - bx, bh = toY(comp_.y1 + 1) - by;
    fillRect(loom, bx, by, bw, bh, colours.ground);
    diamond(loom, bx, by, bw, bh, colours.medallion, 3);
  }

  // The woven structure is complete: snapshot it, so every motif from here on reads its
  // colour against the ground rather than against another motif's threads.
  ctx.baseColour = loom.colour.slice();

  // 5. anchors: k (lamp / tree in a niche) and m (motif slots)
  const anchors = components(inner, new Set(['k', 'm']));
  const isLattice = comp.key === 'tumzemin';
  if (!isLattice) {
    const dPanels = components(inner, new Set(['D']));
    const mComps = components(inner, new Set(['M']));
    // one motif for every slot of the same kind, so compartments read as a set
    const slotPool = pool.filter(k => !['suyolu', 'cengel'].includes(k));
    const slotMotif = rng.pick(slotPool.length ? slotPool : pool);
    for (const a of anchors) {
      const bx = toX(a.x0), by = toY(a.y0), bw = toX(a.x1 + 1) - bx, bh = toY(a.y1 + 1) - by;
      if (a.ch === 'k') {
        // A lamp hangs in its niche. Walk the interior to find the niche, then — when the
        // same niche holds more than one anchor, as a double mihrab does — give each
        // anchor its own horizontal slice of it, so two lamps never stack on one spot.
        const keys = pool.filter(k => ['kandil', 'hayatagaci', 'elibelinde', 'nar', 'kus'].includes(k));
        const key = keys.length ? rng.pick(keys) : (ctx.patterns.kandil ? 'kandil' : pool[0]);
        const cx = a.x0, cy = a.y0;
        let top = cy, bottom = cy, left = cx, right = cx;
        while (top > 0 && INTERIOR.has(inner[top - 1][cx])) top--;
        while (bottom < rows - 1 && INTERIOR.has(inner[bottom + 1][cx])) bottom++;
        while (left > 0 && INTERIOR.has(inner[cy][left - 1])) left--;
        while (right < cols - 1 && INTERIOR.has(inner[cy][right + 1])) right++;
        const share = anchors.filter(o => o.ch === 'k' && o.x0 >= left && o.x1 <= right && o.y0 >= top && o.y1 <= bottom)
          .sort((p, q) => p.y0 - q.y0);
        const slot = Math.max(0, share.findIndex(o => o === a)), nSlots = Math.max(1, share.length);
        const nY0 = toY(top), nY1 = toY(bottom + 1);
        const sliceH = (nY1 - nY0) / nSlots;
        const nicheH = sliceH, nicheW = toX(right + 1) - toX(left);
        const targetH = clamp(Math.round(nicheH * (nSlots > 1 ? 0.7 : 0.42)), 8, 48);
        const targetW = clamp(Math.round(nicheW * 0.55), 8, 48);
        const ccx = Math.round((toX(left) + toX(right + 1)) / 2);
        const ccy = Math.round(nY0 + sliceH * (slot + 0.5));
        placeIn(ctx, key, ccx - Math.round(targetW / 2), ccy - Math.round(targetH / 2), targetW, targetH, 1, motifColours(bgAt(ctx, ccx, ccy)));
      } else {
        const inD = dPanels.some(d => a.x0 >= d.x0 - 1 && a.x1 <= d.x1 + 1 && a.y0 >= d.y0 && a.y1 <= d.y1 + 1);
        if (inD) continue;
        const inM = mComps.some(m => a.x0 > m.x0 && a.x1 < m.x1 && a.y0 > m.y0 && a.y1 < m.y1);
        if (inM && comp.key !== 'aynali') continue;  // placed with the medallion
        // a slot is the anchor's zone box grown by one zone cell each way (its compartment)
        const gx0 = toX(Math.max(0, a.x0 - 1)), gy0 = toY(Math.max(0, a.y0 - 1));
        const gw = toX(Math.min(cols, a.x1 + 2)) - gx0, gh = toY(Math.min(rows, a.y1 + 2)) - gy0;
        const fill = comp.key === 'khesti' ? 0.88 : 0.8;
        placeIn(ctx, slotMotif, gx0, gy0, gw, gh, fill, motifColours(bgAt(ctx, bx + bw / 2, by + bh / 2)), { maxScale: 4 });
      }
    }
    // D panels: densely tiled diamonds / small motifs
    for (const d of dPanels) {
      const bx = toX(d.x0), by = toY(d.y0), bw = toX(d.x1 + 1) - bx, bh = toY(d.y1 + 1) - by;
      const key = pool.includes('disli-baklava') ? 'disli-baklava' : (pool.find(k => ['goz', 'yildiz', 'hac', 'elibelinde', 'kocboynuzu'].includes(k)) || pool[0]);
      const rowsN = Math.max(1, Math.floor(bh / 12));
      const rh = Math.floor(bh / rowsN);
      for (let i = 0; i < rowsN; i++) tileRow(ctx, key, bx, by + i * rh, bw, rh, motifColours(colours.panel), 2);
    }
  }

  // 6. bands: sized on the loom, symmetric top↔bottom, each band one motif repeated
  if (comp.key === 'bandli') {
    fillRect(loom, F.x, F.y, F.w, F.h, colours.ground);
    const pick = rng.shuffle(pool.filter(k => !['suyolu'].includes(k)));
    const motifR = pick[0] || pool[0], motifS = pick[1] || motifR;
    const pr = ctx.patterns[motifR], ps = ctx.patterns[motifS];
    const scale = F.h >= 100 ? rng.int(1, 2) : 1;
    const bandH = Math.max(pr.h, ps.h) * scale + 4;
    const plain = rng.int(2, 5);
    const n = Math.max(1, Math.floor((F.h + plain) / (bandH + plain)));
    const used = n * bandH + (n - 1) * plain;
    const y0 = F.y + Math.floor((F.h - used) / 2);
    const altGround = pickFigure(palette.ground, figure, palette.all) || palette.secondary;
    const gap = rng.int(1, 3);
    // paint every band's ground first, then re-snapshot, so each band's motifs pick a
    // colour that reads against their own band rather than the field behind it
    const bands = [];
    for (let i = 0; i < n; i++) {
      const y = y0 + i * (bandH + plain);
      const mirrorI = Math.min(i, n - 1 - i);          // symmetric top↔bottom
      const bg = mirrorI % 2 === 0 ? palette.ground : altGround;
      fillRect(loom, F.x, y, F.w, bandH, bg);
      bands.push({ y, bg, key: mirrorI % 2 === 0 ? motifR : motifS });
    }
    ctx.baseColour = loom.colour.slice();
    for (const { y, bg, key } of bands) {
      // a band must never come out empty: if the chosen motif will not repeat across a
      // narrow field, fall back to the other one, then to anything in the pool
      let laid = tileRow(ctx, key, F.x + 1, y, F.w - 2, bandH, motifColours(bg), gap, false, bandH - 3);
      if (!laid) laid = tileRow(ctx, key === motifR ? motifS : motifR, F.x + 1, y, F.w - 2, bandH, motifColours(bg), gap, false, bandH - 3);
      if (!laid) for (const alt of rng.shuffle(pool)) { if (tileRow(ctx, alt, F.x + 1, y, F.w - 2, bandH, motifColours(bg), 1, false, bandH - 3)) break; }
    }
  }

  // 7. all-over lattice: a true brick grid — full rows and half-drop rows, both centred
  if (isLattice) {
    const latticePool = pool.filter(k => !['suyolu', 'cengel', 'disli-baklava'].includes(k));
    const key = rng.pick(latticePool.length ? latticePool : pool);
    const pat0 = ctx.patterns[key];
    const k = clamp(Math.floor(Math.min(F.w, F.h) / (pat0.h * 6)), 1, 3);
    const pw = pat0.w * k, ph = pat0.h * k;
    const gap = rng.int(2, 4);
    const cols_ = centreRun(loom.w, pw, gap, F.w, F.x);
    const rows_ = centreRun(loom.h, ph, gap, F.h, F.y);
    const nx = Math.max(1, cols_.n), ny = Math.max(1, rows_.n);
    const stepX = cols_.step, stepY = rows_.step;
    const ox = cols_.s, oy = rows_.s;
    const halfDrop = nx > 2 && rng.chance(0.6);
    const cA = motifColours(colours.ground);
    const cB = { primary: cA.secondary, secondary: cA.primary };
    const twoTone = figure.length > 1 && rng.chance(0.5);
    for (let j = 0; j < ny; j++) {
      // a half-drop row carries one fewer motif so it stays centred on the same field
      const drop = halfDrop && j % 2 === 1;
      const count = drop ? nx - 1 : nx;
      if (count < 1) continue;
      const rowX = Math.round((loom.w - (count * stepX - (stepX - pw))) / 2);
      for (let i = 0; i < count; i++) {
        placeIn(ctx, key, drop ? rowX + i * stepX : ox + i * stepX, oy + j * stepY, pw, ph, 1,
                twoTone && j % 2 === 1 ? cB : cA);
      }
    }
  }

  // 7b. fillers: an open prayer or medallion field is rarely bare — small motifs sit
  //     on a strict lattice in the remaining ground, never sprinkled at random.
  if (['mihrabli', 'cift-mihrab', 'bacali', 'saf', 'madalyonlu', 'bos-gobek'].includes(comp.key) && rng.chance(0.8)) {
    const small = pool.filter(k => ctx.patterns[k] && ctx.patterns[k].w <= 9 && ctx.patterns[k].h <= 9 && !['suyolu', 'cengel'].includes(k));
    const fillerKeys = small.length ? small : ['goz', 'yildiz', 'muska', 'hac', 'pitrak'].filter(k => ctx.patterns[k]);
    if (fillerKeys.length) {
      const key = rng.pick(fillerKeys), pat = ctx.patterns[key];
      const gap = rng.int(4, 7);
      const cx_ = centreRun(loom.w, pat.w, gap, F.w - 4, F.x + 2);
      const cy_ = centreRun(loom.h, pat.h, gap, F.h - 4, F.y + 2);
      const nx = cx_.n, ny = cy_.n, stepX = cx_.step, stepY = cy_.step, ox = cx_.s, oy = cy_.s;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const x = ox + i * stepX, y = oy + j * stepY;
        // only on untouched ground of a single colour, with a clear margin around it
        let ok = true, under = null;
        for (let yy = y - 1; yy <= y + pat.h && ok; yy++) for (let xx = x - 1; xx <= x + pat.w; xx++) {
          const idx = yy * loom.w + xx; const c = loom.colour[idx];
          if (yy < F.y || xx < F.x || yy >= F.y + F.h || xx >= F.x + F.w ||
              loom.motif[idx] || typeof c === 'object' || (under && c !== under)) { ok = false; break; }
          under = c;
        }
        if (!ok) continue;
        placeIn(ctx, key, x, y, pat.w, pat.h, 1, motifColours(under), { maxScale: 1 });
      }
    }
  }

  // 8. aynalı: the axis band carries a running-water meander; mirrorLoom reflects the
  //    panel below it, so no explicit copy is needed here.
  if (comp.key === 'aynali') {
    const axisRow = inner.findIndex(r => r.includes('M'));
    if (axisRow > 0 && ctx.patterns.suyolu) {
      const ay0 = toY(axisRow), ay1 = toY(axisRow + 1);
      tileRow(ctx, 'suyolu', F.x + 1, ay0, F.w - 2, ay1 - ay0, motifColours(colours.wall), 0);
    }
  }
}

/* ------------------------------------------------------------- symmetry */
/**
 * Force the woven loom symmetric. The left half is always reflected onto the right,
 * so the two side borders and both pairs of corners match. The top half is reflected
 * onto the bottom for the border ring always, and for the field too when the
 * composition reads the same either way up (a prayer niche does not).
 *
 * Mirrored cells keep their source's motif index, so hovering a reflected motif still
 * finds its museum label; a mirrored copy is added to `placements` for the inventory.
 */
function mirrorLoom(ctx, F, verticalField) {
  const { loom } = ctx;
  const W = loom.w, H = loom.h;
  const inField = (x, y) => x >= F.x && x < F.x + F.w && y >= F.y && y < F.y + F.h;

  // left → right, whole loom
  for (let y = 0; y < H; y++) for (let x = 0; x < Math.floor(W / 2); x++) {
    const s = y * W + x, d = y * W + (W - 1 - x);
    loom.colour[d] = loom.colour[s];
    loom.motif[d] = loom.motif[s];
  }
  // top → bottom: the border ring always, the field only when it reads both ways up
  for (let y = 0; y < Math.floor(H / 2); y++) for (let x = 0; x < W; x++) {
    const ty = H - 1 - y;
    if (!verticalField && inField(x, ty)) continue;
    const s = y * W + x, d = ty * W + x;
    loom.colour[d] = loom.colour[s];
    loom.motif[d] = loom.motif[s];
  }

  // mirrored twins for the inventory (same index, so hover resolves to the original).
  // A twin that lands where a motif was already woven — the far border run, say — is
  // not added, so the inventory counts each woven motif exactly once.
  const twins = [];
  const taken = new Set(ctx.placements.map(p => `${p.key}|${p.x}|${p.y}`));
  const add = (p, x, y) => {
    if (x === p.x && y === p.y) return;
    if (x < 0 || y < 0 || x + p.w > W || y + p.h > H) return;
    const k = `${p.key}|${x}|${y}`;
    if (taken.has(k)) return;
    taken.add(k);
    twins.push({ ...p, x, y, mirror: true });
  };
  for (const p of ctx.placements) {
    const hx = W - p.x - p.w;
    const rightHalf = p.x + p.w / 2 > W / 2;
    if (!rightHalf) add(p, hx, p.y);                       // its reflection on the right
    if (verticalField || p.border) {
      const vy = H - p.y - p.h;
      const lowerHalf = p.y + p.h / 2 > H / 2;
      if (!lowerHalf) {
        add(p, p.x, vy);
        if (!rightHalf) add(p, hx, vy);
      }
    }
  }
  ctx.placements.push(...twins);
}

/**
 * weaveComposition({ comp, palette, patterns, pool, rng, gridW, gridH })
 * → { loom, placements, field }
 */
export function weaveComposition(opts) {
  const { comp, palette, patterns, pool, rng, gridW, gridH } = opts;
  const loom = { w: gridW, h: gridH, colour: new Array(gridW * gridH).fill(palette.ground), motif: new Int16Array(gridW * gridH) };
  const ctx = { loom, rng, palette, patterns, pool, placements: [],
                figure: palette.colours.filter(c => c !== palette.ground),
                verticalSym: V_SYMMETRIC.has(comp.key) };
  const F = weaveBorders(ctx);
  weaveField(ctx, F, comp);
  mirrorLoom(ctx, F, ctx.verticalSym);
  return { loom, placements: ctx.placements, field: F, borderCells: ctx.borderCells };
}
