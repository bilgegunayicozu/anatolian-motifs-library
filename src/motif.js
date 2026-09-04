// motif.js — motif patterns as loom-resolution pixel masks.
//
// A pattern is { w, h, cells: Uint8Array } with one code per cell:
//   0  empty (the field shows through)
//   1  primary colour     ■
//   2  secondary colour   □
//   3–6  a primary *half-cell* (eccentric weft) with one corner missing:
//        3 = top-left missing, 4 = top-right, 5 = bottom-right, 6 = bottom-left.
//        Only weaverHand produces these, and only on curvilinear motifs.
//
// Grids in /data are stored as rows of '.', '1', '2' (see tools/build-data.py).

export const EMPTY = 0, PRIMARY = 1, SECONDARY = 2, HALF_BASE = 3;
export const isHalf = code => code >= 3 && code <= 6;
export const isFilled = code => code !== 0;

/** rows of '.', '1', '2' → pattern */
export function parseGrid(rows) {
  const h = rows.length, w = h ? rows[0].length : 0;
  const cells = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const r = rows[y];
    for (let x = 0; x < w; x++) {
      const ch = r[x];
      cells[y * w + x] = ch === '1' ? 1 : ch === '2' ? 2 : ch === '#' ? 1 : 0;
    }
  }
  return { w, h, cells };
}

/** pattern → rows of '.', '1', '2' (half-cells collapse to '1'). */
export function gridToRows(p) {
  const out = [];
  for (let y = 0; y < p.h; y++) {
    let s = '';
    for (let x = 0; x < p.w; x++) {
      const c = p.cells[y * p.w + x];
      s += c === 0 ? '.' : c === 2 ? '2' : '1';
    }
    out.push(s);
  }
  return out;
}

export function clonePattern(p) { return { w: p.w, h: p.h, cells: new Uint8Array(p.cells) }; }
export function cellAt(p, x, y) { return (x < 0 || y < 0 || x >= p.w || y >= p.h) ? 0 : p.cells[y * p.w + x]; }

/** Mirror the half-cell corner codes when a pattern is flipped. */
const flipHalfH = c => isHalf(c) ? ({ 3: 4, 4: 3, 5: 6, 6: 5 })[c] : c;
const flipHalfV = c => isHalf(c) ? ({ 3: 6, 6: 3, 4: 5, 5: 4 })[c] : c;

export function flipH(p) {
  const out = clonePattern(p);
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++)
    out.cells[y * p.w + (p.w - 1 - x)] = flipHalfH(p.cells[y * p.w + x]);
  return out;
}
export function flipV(p) {
  const out = clonePattern(p);
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++)
    out.cells[(p.h - 1 - y) * p.w + x] = flipHalfV(p.cells[y * p.w + x]);
  return out;
}
export function rotate180(p) { return flipH(flipV(p)); }
/** 90° clockwise — used for motifs running along vertical borders. */
export function rotate90(p) {
  const out = { w: p.h, h: p.w, cells: new Uint8Array(p.w * p.h) };
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    const c = p.cells[y * p.w + x];
    const rc = isHalf(c) ? ({ 3: 4, 4: 5, 5: 6, 6: 3 })[c] : c;
    out.cells[x * out.w + (p.h - 1 - y)] = rc;
  }
  return out;
}

/** Is the pattern mirror-symmetric left↔right? (ignores half-cell orientation) */
export function isSymmetricH(p) {
  for (let y = 0; y < p.h; y++) for (let x = 0; x < Math.floor(p.w / 2); x++) {
    const a = p.cells[y * p.w + x], b = p.cells[y * p.w + (p.w - 1 - x)];
    if ((a === 0) !== (b === 0) || (a === 2) !== (b === 2)) return false;
  }
  return true;
}
export function isSymmetricV(p) {
  for (let x = 0; x < p.w; x++) for (let y = 0; y < Math.floor(p.h / 2); y++) {
    const a = p.cells[y * p.w + x], b = p.cells[(p.h - 1 - y) * p.w + x];
    if ((a === 0) !== (b === 0) || (a === 2) !== (b === 2)) return false;
  }
  return true;
}

/** Count of filled cells — the "loom count" of a motif. */
export function filledCount(p) { let n = 0; for (const c of p.cells) if (c) n++; return n; }

/**
 * renderMotif(pattern, primary, secondary) → 2D array [h][w] of
 *   null | '#hex' | { c: '#hex', half: k }   (k = missing corner, 0..3)
 * This is the one contract every consumer (loom, swatches, variations) reads.
 */
export function renderMotif(pattern, primary, secondary = primary) {
  const out = new Array(pattern.h);
  for (let y = 0; y < pattern.h; y++) {
    const row = new Array(pattern.w);
    for (let x = 0; x < pattern.w; x++) {
      const c = pattern.cells[y * pattern.w + x];
      row[x] = c === 0 ? null : c === 1 ? primary : c === 2 ? secondary : { c: primary, half: c - HALF_BASE };
    }
    out[y] = row;
  }
  return out;
}

/**
 * Stamp a rendered motif (from renderMotif) onto a loom canvas at (x0, y0).
 * loom: { w, h, colour: Array<string|object|null>, motif: Uint8Array } — colour is the woven
 * colour per cell, motif marks cells that belong to a placed motif (for cicim relief + hover).
 */
export function stamp(loom, rendered, x0, y0, placementIndex = 1) {
  const h = rendered.length, w = h ? rendered[0].length : 0;
  for (let y = 0; y < h; y++) {
    const ly = y0 + y; if (ly < 0 || ly >= loom.h) continue;
    for (let x = 0; x < w; x++) {
      const lx = x0 + x; if (lx < 0 || lx >= loom.w) continue;
      const v = rendered[y][x]; if (v === null) continue;
      // a half-cell keeps the colour it was woven over, so the loom can paint the other half
      loom.colour[ly * loom.w + lx] = typeof v === 'object' ? { ...v, under: loom.colour[ly * loom.w + lx] } : v;
      loom.motif[ly * loom.w + lx] = placementIndex;
    }
  }
}

/** Scale a pattern by an integer factor (used to grow a small glyph into a medallion). */
export function scalePattern(p, k) {
  if (k <= 1) return p;
  const out = { w: p.w * k, h: p.h * k, cells: new Uint8Array(p.w * p.h * k * k) };
  for (let y = 0; y < out.h; y++) for (let x = 0; x < out.w; x++) {
    const c = p.cells[Math.floor(y / k) * p.w + Math.floor(x / k)];
    out.cells[y * out.w + x] = isHalf(c) ? 1 : c;
  }
  return out;
}
