// composition.js — turns a composition zone-map (data/compositions.json) into a
// woven loom: borders, guard stripes, niches, bands, compartments, medallions, and
// motif placements. Each zone character has a rule; the coarse map is scaled onto
// the loom and refined where a coarse block would look wrong (niche arches are
// interpolated into stepped outlines; medallions are re-rasterised as diamonds).
//
// The loom it returns is plain data: { w, h, colour[], motif[] } plus placements.
// Nothing here draws; loom.js paints it.

import { renderMotif, stamp, scalePattern, rotate90, flipV, flipH, isFilled } from './motif.js';
import { luminance } from './palette.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const INTERIOR = new Set(['N', 'k', 'm']);
const BORDER_MOTIFS = ['cengel', 'suyolu', 'goz', 'kurtagzi', 'disli-baklava', 'muska', 'pitrak'];

/** Most contrasting colour against `bg` from a list. */
function contrastTo(bg, colours) {
  const lb = luminance(bg);
  return colours.slice().sort((a, b) => Math.abs(luminance(b) - lb) - Math.abs(luminance(a) - lb))[0];
}

/** Fill a rectangle of the loom with a colour (and clear motif marks). */
function fillRect(loom, x0, y0, w, h, colour) {
  for (let y = Math.max(0, y0); y < Math.min(loom.h, y0 + h); y++)
    for (let x = Math.max(0, x0); x < Math.min(loom.w, x0 + w); x++) {
      loom.colour[y * loom.w + x] = colour; loom.motif[y * loom.w + x] = 0;
    }
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
 * Place a motif centred in a loom-cell box, scaled by an integer factor so it fills
 * `fill` of the box (never larger than the box). Returns the placement record.
 */
function placeIn(ctx, motifKey, bx, by, bw, bh, fill, colours, opts = {}) {
  const pat0 = ctx.patterns[motifKey]; if (!pat0) return null;
  let k = Math.floor(Math.min((bw * fill) / pat0.w, (bh * fill) / pat0.h));
  k = clamp(k, 1, opts.maxScale ?? 6);
  let pat = scalePattern(pat0, k);
  if (opts.flipV) pat = flipV(pat);
  if (pat.w > bw + 2 || pat.h > bh + 2) return null;      // does not fit even at 1×
  const x = Math.round(bx + (bw - pat.w) / 2), y = Math.round(by + (bh - pat.h) / 2);
  const rendered = renderMotif(pat, colours.primary, colours.secondary);
  const index = ctx.placements.length + 1;
  stamp(ctx.loom, rendered, x, y, index);
  const rec = { index, key: motifKey, x, y, w: pat.w, h: pat.h, scale: k, primary: colours.primary, secondary: colours.secondary };
  ctx.placements.push(rec);
  return rec;
}

/** Tile a motif along a horizontal strip (y0..y0+h), centred vertically. */
function tileRow(ctx, motifKey, x0, y0, w, h, colours, gap = 1, rotate = false, scaleTo = null) {
  let pat = ctx.patterns[motifKey]; if (!pat) return 0;
  if (rotate) pat = rotate90(pat);
  const fitH = scaleTo ?? h;
  const k = clamp(Math.floor((fitH - 1) / pat.h), 1, 4);
  pat = scalePattern(pat, k);
  if (pat.h > h) return 0;
  const step = pat.w + gap;
  const n = Math.floor((w + gap) / step); if (n < 1) return 0;
  const used = n * step - gap, sx = x0 + Math.floor((w - used) / 2), y = y0 + Math.floor((h - pat.h) / 2);
  const rendered = renderMotif(pat, colours.primary, colours.secondary);
  for (let i = 0; i < n; i++) {
    const index = ctx.placements.length + 1;
    const x = sx + i * step;
    stamp(ctx.loom, rendered, x, y, index);
    ctx.placements.push({ index, key: motifKey, x, y, w: pat.w, h: pat.h, scale: k, primary: colours.primary, secondary: colours.secondary, border: !!ctx.inBorder });
  }
  return n;
}
/** Tile a motif along a vertical strip (rotated 90°). */
function tileCol(ctx, motifKey, x0, y0, w, h, colours, gap = 1) {
  let pat = ctx.patterns[motifKey]; if (!pat) return 0;
  pat = rotate90(pat);
  const k = clamp(Math.floor((w - 1) / pat.w), 1, 4);
  pat = scalePattern(pat, k);
  if (pat.w > w) return 0;
  const step = pat.h + gap, n = Math.floor((h + gap) / step); if (n < 1) return 0;
  const used = n * step - gap, sy = y0 + Math.floor((h - used) / 2), x = x0 + Math.floor((w - pat.w) / 2);
  const rendered = renderMotif(pat, colours.primary, colours.secondary);
  for (let i = 0; i < n; i++) {
    const index = ctx.placements.length + 1, y = sy + i * step;
    stamp(ctx.loom, rendered, x, y, index);
    ctx.placements.push({ index, key: motifKey, x, y, w: pat.w, h: pat.h, scale: k, primary: colours.primary, secondary: colours.secondary, border: true });
  }
  return n;
}

/** Rasterise a stepped diamond in a box (2-cell steps), filled or as an outline. */
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
function weaveBorders(ctx) {
  const { loom, rng, palette, pool } = ctx;
  const short = Math.min(loom.w, loom.h);
  const bT = clamp(Math.round(short * 0.075), 6, 11);
  const gT = clamp(Math.round(short * 0.025), 2, 4);
  const bands = short >= 84 && rng.chance(0.5) ? 2 : 1;

  let inset = 0;
  const borderKeys = pool.filter(k => BORDER_MOTIFS.includes(k));
  const fallback = ['cengel', 'suyolu', 'goz'].filter(k => ctx.patterns[k]);
  const choices = borderKeys.length ? borderKeys : fallback;
  ctx.inBorder = true;
  for (let b = 0; b < bands; b++) {
    const thick = b === 0 ? bT : Math.max(5, Math.round(bT * 0.7));
    const ground = b === 0 ? palette.border : (rng.chance(0.5) ? palette.ground : palette.guard);
    const fig = contrastTo(ground, palette.colours.concat(palette.ground).filter(c => c !== ground));
    const fig2 = contrastTo(ground, palette.colours.filter(c => c !== ground && c !== fig)) || fig;
    // ground of the band
    fillRect(loom, inset, inset, loom.w - 2 * inset, thick, ground);
    fillRect(loom, inset, loom.h - inset - thick, loom.w - 2 * inset, thick, ground);
    fillRect(loom, inset, inset, thick, loom.h - 2 * inset, ground);
    fillRect(loom, loom.w - inset - thick, inset, thick, loom.h - 2 * inset, ground);
    const key = rng.pick(choices);
    const colours = { primary: fig, secondary: fig2 };
    const gap = rng.int(1, 2);
    // horizontal runs (between the vertical bands), vertical runs full height
    tileRow(ctx, key, inset + thick, inset, loom.w - 2 * (inset + thick), thick, colours, gap);
    tileRow(ctx, key, inset + thick, loom.h - inset - thick, loom.w - 2 * (inset + thick), thick, colours, gap);
    tileCol(ctx, key, inset, inset, thick, loom.h - 2 * inset, colours, gap);
    tileCol(ctx, key, loom.w - inset - thick, inset, thick, loom.h - 2 * inset, colours, gap);
    inset += thick;
    // guard stripe with reciprocal teeth
    const gA = palette.guard === ground ? palette.primary : palette.guard;
    const gB = contrastTo(gA, palette.colours.concat(palette.ground).filter(c => c !== gA));
    fillRect(loom, inset, inset, loom.w - 2 * inset, gT, gA);
    fillRect(loom, inset, loom.h - inset - gT, loom.w - 2 * inset, gT, gA);
    fillRect(loom, inset, inset, gT, loom.h - 2 * inset, gA);
    fillRect(loom, loom.w - inset - gT, inset, gT, loom.h - 2 * inset, gA);
    if (gT >= 2) {   // teeth: alternate cells on the inner edge
      for (let x = inset; x < loom.w - inset; x++) if ((x - inset) % 2 === 0) {
        loom.colour[(inset + gT - 1) * loom.w + x] = gB; loom.colour[(loom.h - inset - gT) * loom.w + x] = gB;
      }
      for (let y = inset; y < loom.h - inset; y++) if ((y - inset) % 2 === 0) {
        loom.colour[y * loom.w + inset + gT - 1] = gB; loom.colour[y * loom.w + loom.w - inset - gT] = gB;
      }
    }
    inset += gT;
  }
  ctx.inBorder = false;
  ctx.borderCells = inset;
  return { x: inset, y: inset, w: loom.w - 2 * inset, h: loom.h - 2 * inset };
}

/* ------------------------------------------------------------------ niches */
/**
 * Refine niche rows: interpolate the interior spans of N/k/m runs across loom rows so
 * arches step smoothly, then paint interior / wall / spandrel with a fixed wall thickness.
 */
function weaveNiches(ctx, F, inner, zx, zy, colours) {
  const { loom } = ctx;
  const rows = inner.length, cols = inner[0].length;
  const rowHasNiche = inner.map(r => r.includes('A') || r.includes('a'));
  if (!rowHasNiche.some(Boolean)) return;
  const wallT = clamp(Math.round(F.w * 0.025), 2, 4);
  const toX = c => F.x + Math.round(c * F.w / cols);
  const toY = r => F.y + Math.round(r * F.h / rows);

  // keyframes: [{ y, spans:[{l,r}] (loom cols) }]
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
        // width at the open end = the interior run of the neighbouring row under this apex
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
    if (!prev) return next && !next.wallLine ? null : null;
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
        const c = (y - keys.find(k => k.wallLine && k.y <= y && y < k.y1)?.y ?? 0) < wallT ? colours.wall : colours.spandrel;
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
function fillCell(loom, x, y, colour) {
  if (x < 0 || y < 0 || x >= loom.w || y >= loom.h) return;
  loom.colour[y * loom.w + x] = colour; loom.motif[y * loom.w + x] = 0;
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

  const figure = palette.colours.filter(c => c !== palette.ground);
  const colours = {
    ground: palette.ground,
    wall: palette.wall,
    spandrel: contrastTo(palette.ground, figure.filter(c => c !== palette.wall)) || palette.secondary,
    panel: figure[figure.length - 1] === palette.ground ? palette.secondary : figure[Math.min(2, figure.length - 1)],
    medallion: palette.primary,
    compartmentWall: palette.wall,
  };
  const motifColours = (bg) => {
    const p = contrastTo(bg, figure.filter(c => c !== bg));
    const s = contrastTo(bg, figure.filter(c => c !== bg && c !== p)) || p;
    return { primary: p, secondary: s };
  };

  // 1. base paint from the zone characters
  for (let y = F.y; y < F.y + F.h; y++) for (let x = F.x; x < F.x + F.w; x++) {
    const ch = inner[zy(y)][zx(x)];
    let c = colours.ground;
    if (ch === 'A' || ch === 'a') c = colours.wall;
    else if (ch === '.') c = colours.spandrel;
    else if (ch === 'T' || ch === 'L' || ch === 'D') c = colours.panel;
    else if (ch === 'M' || ch === 'O') c = colours.ground;
    else if (ch === '|' || ch === '-') c = colours.compartmentWall;
    fillCell(loom, x, y, c);
  }
  // spandrel rule: bandlı '.' rows are plain strips of ground, not spandrels
  if (comp.key === 'bandli') for (let y = F.y; y < F.y + F.h; y++) for (let x = F.x; x < F.x + F.w; x++) {
    if (inner[zy(y)][zx(x)] === '.') fillCell(loom, x, y, colours.ground);
  }

  // 2. niches: interpolate arches
  weaveNiches(ctx, F, inner, zx, zy, colours);

  // 3. compartment walls as 2-cell lines
  const wallW = 2;
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
    const ch = inner[r][c];
    if (ch === '|') { const x = Math.round((toX(c) + toX(c + 1)) / 2) - 1; fillRect(loom, x, toY(r), wallW, toY(r + 1) - toY(r), colours.compartmentWall); fillRect(loom, toX(c), toY(r), toX(c + 1) - toX(c), toY(r + 1) - toY(r), colours.ground); fillRect(loom, x, toY(r), wallW, toY(r + 1) - toY(r), colours.compartmentWall); }
    if (ch === '-') { const y = Math.round((toY(r) + toY(r + 1)) / 2) - 1; fillRect(loom, toX(c), toY(r), toX(c + 1) - toX(c), toY(r + 1) - toY(r), colours.ground); fillRect(loom, toX(c), y, toX(c + 1) - toX(c), wallW, colours.compartmentWall); }
  }

  // 4. medallions: re-rasterise M and O components as diamonds
  for (const comp_ of components(inner, new Set(['M']))) {
    // include the m anchor inside for the bbox
    const mm = components(inner, new Set(['m'])).filter(a => a.x0 >= comp_.x0 && a.x1 <= comp_.x1 && a.y0 >= comp_.y0 && a.y1 <= comp_.y1);
    const bx = toX(comp_.x0), by = toY(comp_.y0), bw = toX(comp_.x1 + 1) - bx, bh = toY(comp_.y1 + 1) - by;
    if (comp.key === 'aynali') { fillRect(loom, bx, by, bw, bh, colours.wall); continue; }  // the mirror axis
    fillRect(loom, bx, by, bw, bh, colours.ground);
    diamond(loom, bx, by, bw, bh, colours.medallion);
    const innerC = contrastTo(colours.medallion, figure.concat(palette.ground).filter(c => c !== colours.medallion));
    diamond(loom, bx + Math.round(bw * 0.12), by + Math.round(bh * 0.12), Math.round(bw * 0.76), Math.round(bh * 0.76), innerC);
    const core = { primary: colours.medallion, secondary: contrastTo(innerC, figure.filter(c => c !== innerC && c !== colours.medallion)) || colours.medallion };
    const key = pool.includes('basamakli-gobek') ? 'basamakli-gobek' : (pool.find(k => ['hac', 'goz', 'yildiz', 'disli-baklava'].includes(k)) || pool[0]);
    placeIn(ctx, key, bx, by, bw, bh, 0.72, core);
    mm.forEach(() => {});
    // quarter medallions in the field corners (Uşak / Kars habit)
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

  // 5. anchors: k (lamp / tree in a niche) and m (motif slots)
  const anchors = components(inner, new Set(['k', 'm']));
  const isLattice = comp.key === 'tumzemin';
  if (!isLattice) {
    // m anchors inside D panels are tiled, not placed
    const dPanels = components(inner, new Set(['D']));
    let slotMotif = null;
    for (const a of anchors) {
      const bx = toX(a.x0), by = toY(a.y0), bw = toX(a.x1 + 1) - bx, bh = toY(a.y1 + 1) - by;
      if (a.ch === 'k') {
        // a lamp hangs from the apex, a tree rises from the base — size it to its niche:
        // walk up and down the anchor's column while the zone is interior to find the niche height,
        // and along its row for the width.
        const keys = pool.filter(k => ['kandil', 'hayatagaci', 'elibelinde', 'nar', 'kus'].includes(k));
        const key = keys.length ? rng.pick(keys) : (ctx.patterns.kandil ? 'kandil' : pool[0]);
        const cx = a.x0, cy = a.y0;
        let top = cy, bottom = cy, left = cx, right = cx;
        while (top > 0 && INTERIOR.has(inner[top - 1][cx])) top--;
        while (bottom < rows - 1 && INTERIOR.has(inner[bottom + 1][cx])) bottom++;
        while (left > 0 && INTERIOR.has(inner[cy][left - 1])) left--;
        while (right < cols - 1 && INTERIOR.has(inner[cy][right + 1])) right++;
        const nicheH = toY(bottom + 1) - toY(top), nicheW = toX(right + 1) - toX(left);
        const targetH = clamp(Math.round(nicheH * 0.42), 8, 48);
        const targetW = clamp(Math.round(nicheW * 0.55), 8, 48);
        const ccx = Math.round((toX(left) + toX(right + 1)) / 2), ccy = Math.round((toY(top) + toY(bottom + 1)) / 2);
        placeIn(ctx, key, ccx - Math.round(targetW / 2), ccy - Math.round(targetH / 2), targetW, targetH, 1, motifColours(colours.ground));
      } else {
        const inD = dPanels.some(d => a.x0 >= d.x0 - 1 && a.x1 <= d.x1 + 1 && a.y0 >= d.y0 && a.y1 <= d.y1 + 1);
        if (inD) continue;
        const inM = components(inner, new Set(['M'])).some(m => a.x0 > m.x0 && a.x1 < m.x1 && a.y0 > m.y0 && a.y1 < m.y1);
        if (inM && comp.key !== 'aynali') continue;  // placed with the medallion
        if (!slotMotif) slotMotif = rng.pick(pool.filter(k => !['suyolu', 'cengel'].includes(k)).length ? pool.filter(k => !['suyolu', 'cengel'].includes(k)) : pool);
        const key = comp.key === 'khesti' ? slotMotif : rng.pick(pool.filter(k => k !== 'suyolu').length ? pool.filter(k => k !== 'suyolu') : pool);
        // a slot is the anchor's zone box grown by one zone cell each way (its compartment / panel)
        const gx0 = toX(Math.max(0, a.x0 - 1)), gy0 = toY(Math.max(0, a.y0 - 1));
        const gw = toX(Math.min(cols, a.x1 + 2)) - gx0, gh = toY(Math.min(rows, a.y1 + 2)) - gy0;
        const fill = comp.key === 'khesti' ? 0.88 : 0.8;
        placeIn(ctx, key, gx0, gy0, gw, gh, fill, motifColours(colours.panel === loom.colour[by * loom.w + bx] ? colours.panel : colours.ground));
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

  // 6. bands: r / s rows tile one motif each
  if (comp.key === 'bandli') {
    // bands are sized on the loom: motif height + selvedge, plain strips between, symmetric top↔bottom
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
    const grounds = rng.shuffle(figure).filter(c => c !== palette.ground);
    const altGround = grounds[0] || palette.secondary;
    for (let i = 0; i < n; i++) {
      const y = y0 + i * (bandH + plain);
      const mirrorI = Math.min(i, n - 1 - i);          // symmetric top↔bottom
      const bg = mirrorI % 2 === 0 ? palette.ground : altGround;
      const key = mirrorI % 2 === 0 ? motifR : motifS;
      fillRect(loom, F.x, y, F.w, bandH, bg);
      tileRow(ctx, key, F.x + 1, y, F.w - 2, bandH, motifColours(bg), rng.int(1, 3), false, bandH - 3);
    }
  }

  // 7. all-over lattice
  if (isLattice) {
    const key = rng.pick(pool.filter(k => !['suyolu', 'cengel', 'disli-baklava'].includes(k)).length ? pool.filter(k => !['suyolu', 'cengel', 'disli-baklava'].includes(k)) : pool);
    const pat0 = ctx.patterns[key];
    const k = clamp(Math.floor(Math.min(F.w, F.h) / (pat0.h * 6)), 1, 3);
    const pw = pat0.w * k, ph = pat0.h * k, gap = rng.int(2, 4);
    const nx = Math.max(1, Math.floor((F.w + gap) / (pw + gap))), ny = Math.max(1, Math.floor((F.h + gap) / (ph + gap)));
    const ox = F.x + Math.floor((F.w - (nx * (pw + gap) - gap)) / 2), oy = F.y + Math.floor((F.h - (ny * (ph + gap) - gap)) / 2);
    const cA = motifColours(colours.ground);
    const cB = { primary: cA.secondary, secondary: cA.primary };
    const halfDrop = rng.chance(0.7);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const shift = halfDrop && j % 2 === 1 ? Math.floor((pw + gap) / 2) : 0;
      const x = ox + i * (pw + gap) + shift; if (x + pw > F.x + F.w) continue;
      const alt = (i + j) % 2 === 1;
      placeIn(ctx, key, x, oy + j * (ph + gap), pw, ph, 1, alt ? cB : cA, { flipV: alt && rng.chance(0.5) });
    }
  }

  // 7b. fillers: prayer and medallion fields are rarely bare — small motifs are sprinkled
  //     on the open ground around the anchors (göz, yıldız, çengel, muska…), scale 1.
  if (['mihrabli', 'cift-mihrab', 'bacali', 'saf', 'madalyonlu', 'khesti', 'bos-gobek'].includes(comp.key) && rng.chance(comp.key === 'khesti' ? 0.35 : 0.85)) {
    const small = pool.filter(k => ctx.patterns[k] && ctx.patterns[k].w <= 9 && ctx.patterns[k].h <= 9 && !['suyolu', 'cengel'].includes(k));
    const fillerKeys = small.length ? small : ['goz', 'yildiz', 'muska', 'hac', 'pitrak'].filter(k => ctx.patterns[k]);
    if (fillerKeys.length) {
      const key = rng.pick(fillerKeys), pat = ctx.patterns[key];
      const gap = rng.int(3, 6), step = Math.max(pat.w, pat.h) + gap;
      const density = rng.range(0.35, 0.8);
      const groundSet = new Set([colours.ground, colours.spandrel, colours.panel]);
      const cA = motifColours(colours.ground);
      for (let y = F.y + 2; y + pat.h < F.y + F.h - 2; y += step) {
        const shift = Math.floor((y - F.y) / step) % 2 ? Math.floor(step / 2) : 0;
        for (let x = F.x + 2 + shift; x + pat.w < F.x + F.w - 2; x += step) {
          if (!rng.chance(density)) continue;
          // only on untouched ground: every cell under the motif must be plain ground of one colour
          let ok = true, under = null;
          for (let yy = y - 1; yy <= y + pat.h && ok; yy++) for (let xx = x - 1; xx <= x + pat.w; xx++) {
            const i = yy * loom.w + xx; const c = loom.colour[i];
            if (loom.motif[i] || typeof c === 'object' || !groundSet.has(c) || (under && c !== under)) { ok = false; break; }
            under = c;
          }
          if (!ok) continue;
          const cols_ = under === colours.ground ? cA : motifColours(under);
          placeIn(ctx, key, x, y, pat.w, pat.h, 1, cols_, { maxScale: 1 });
        }
      }
    }
  }

  // 8. mirrored panels: the bottom half is the top half reflected
  if (comp.key === 'aynali') {
    const axisRow = inner.findIndex(r => r.includes('M'));
    if (axisRow > 0) {
      const ay0 = toY(axisRow), ay1 = toY(axisRow + 1);
      // axis band gets a running-water meander
      const meander = ctx.patterns.suyolu ? 'suyolu' : null;
      if (meander) tileRow(ctx, meander, F.x + 1, ay0, F.w - 2, ay1 - ay0, motifColours(colours.wall), 0);
      const top = ay0 - F.y, bottom = F.y + F.h - ay1;
      const n = Math.min(top, bottom);
      const mirrored = [];
      for (let i = 0; i < n; i++) {
        const sy = ay0 - 1 - i, ty = ay1 + i;
        for (let x = F.x; x < F.x + F.w; x++) {
          loom.colour[ty * loom.w + x] = loom.colour[sy * loom.w + x];
          const m = loom.motif[sy * loom.w + x];
          loom.motif[ty * loom.w + x] = m ? -m : 0;
        }
      }
      // mirrored placements for hover
      for (const p of ctx.placements.slice()) {
        if (p.border || p.y + p.h > ay0 || p.y < F.y) continue;
        const ny = ay1 + (ay0 - (p.y + p.h));
        if (ny + p.h <= F.y + F.h) mirrored.push({ ...p, index: -p.index, y: ny, mirror: true });
      }
      ctx.mirrored = mirrored;
    }
  }
}

/**
 * weaveComposition({ comp, palette, patterns, pool, rng, gridW, gridH })
 * → { loom, placements, field }
 */
export function weaveComposition(opts) {
  const { comp, palette, patterns, pool, rng, gridW, gridH } = opts;
  const loom = { w: gridW, h: gridH, colour: new Array(gridW * gridH).fill(palette.ground), motif: new Int16Array(gridW * gridH) };
  const ctx = { loom, rng, palette, patterns, pool, placements: [], mirrored: [] };
  const F = weaveBorders(ctx);
  weaveField(ctx, F, comp);
  return { loom, placements: ctx.placements.concat(ctx.mirrored), field: F, borderCells: ctx.borderCells };
}
