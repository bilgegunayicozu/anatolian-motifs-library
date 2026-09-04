// weaverhand.js — the weaver's hand.
//
// Real woven motifs differ from the book drawing the way a hand differs from a ruler:
// an arm a cell longer, a hook that does not quite close, a skirt one row deeper.
// weaverHand(pattern, seed, opts) applies a seeded handful of such nudges to a base
// grid and returns a new pattern. Symmetric motifs stay symmetric — the weaver counts
// both halves. Curvilinear motifs may also get their staircase corners softened into
// half-cells (eccentric weft), which is how a loom approximates a curve.
//
// Nothing here calls Math.random: all chance comes from makeRng(seed).

import { makeRng } from './rng.js';
import { clonePattern, cellAt, isSymmetricH, isHalf, filledCount, HALF_BASE } from './motif.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function set(p, x, y, v) { if (x >= 0 && y >= 0 && x < p.w && y < p.h) p.cells[y * p.w + x] = v; }
function filledNeighbours(p, x, y) {
  const out = [];
  for (const [dx, dy] of DIRS) if (cellAt(p, x + dx, y + dy)) out.push([dx, dy]);
  return out;
}
/** Grow the canvas by one cell on the given side(s) so a limb can extend past the edge. */
function pad(p, left, right, top, bottom) {
  const w = p.w + left + right, h = p.h + top + bottom;
  const cells = new Uint8Array(w * h);
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) cells[(y + top) * w + (x + left)] = p.cells[y * p.w + x];
  return { w, h, cells };
}

/* ----- the nudges. Each takes (pattern, rng, sym) and returns a pattern (or null if n/a). */

// A limb end grows by one cell, or shrinks by one.
function nudgeLimb(p, rng, sym) {
  const ends = [];
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    const c = p.cells[y * p.w + x];
    if (!c || isHalf(c)) continue;
    const nb = filledNeighbours(p, x, y);
    if (nb.length === 1) ends.push({ x, y, dx: -nb[0][0], dy: -nb[0][1] });
  }
  if (!ends.length) return null;
  const e = rng.pick(ends);
  let out = clonePattern(p);
  const extend = rng.chance(0.6);
  const apply = (x, y, dx, dy) => {
    if (extend) {
      const tx = x + dx, ty = y + dy;
      if (tx < 0 || ty < 0 || tx >= out.w || ty >= out.h) return false;
      if (out.cells[ty * out.w + tx]) return false;
      out.cells[ty * out.w + tx] = out.cells[y * out.w + x];
    } else {
      out.cells[y * out.w + x] = 0;
    }
    return true;
  };
  // Make room if the limb wants to grow past the edge.
  if (extend) {
    const tx = e.x + e.dx, ty = e.y + e.dy;
    let l = 0, r = 0, t = 0, b = 0;
    if (tx < 0) l = 1; if (tx >= out.w) r = 1; if (ty < 0) t = 1; if (ty >= out.h) b = 1;
    if (sym && (l || r)) { l = 1; r = 1; }
    if (l || r || t || b) { out = pad(out, l, r, t, b); e.x += l; e.y += t; }
  }
  if (!apply(e.x, e.y, e.dx, e.dy)) return null;
  if (sym) {
    const mx = out.w - 1 - e.x;
    if (mx !== e.x) apply(mx, e.y, -e.dx, e.dy);
  }
  return out;
}

// A hook closes: an empty cell with two filled neighbours at right angles gets filled.
function closeHook(p, rng, sym) {
  const cands = [];
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    if (p.cells[y * p.w + x]) continue;
    const nb = filledNeighbours(p, x, y);
    if (nb.length === 2 && (nb[0][0] !== -nb[1][0] || nb[0][1] !== -nb[1][1])) cands.push({ x, y });
  }
  if (!cands.length) return null;
  const c = rng.pick(cands);
  const out = clonePattern(p);
  const colour = cellAt(p, c.x + 1, c.y) || cellAt(p, c.x - 1, c.y) || cellAt(p, c.x, c.y + 1) || cellAt(p, c.x, c.y - 1) || 1;
  set(out, c.x, c.y, isHalf(colour) ? 1 : colour);
  if (sym) set(out, out.w - 1 - c.x, c.y, isHalf(colour) ? 1 : colour);
  return out;
}

// The skirt deepens or shallows: one row is doubled or dropped.
function skirtRow(p, rng) {
  const grow = rng.chance(0.55) || p.h < 5;
  const y = rng.int(Math.floor(p.h / 3), p.h - 1);
  const h = p.h + (grow ? 1 : -1);
  if (h < 3) return null;
  const out = { w: p.w, h, cells: new Uint8Array(p.w * h) };
  let sy = 0;
  for (let ty = 0; ty < h; ty++) {
    if (!grow && sy === y) sy++;
    out.cells.set(p.cells.subarray(sy * p.w, (sy + 1) * p.w), ty * p.w);
    if (!(grow && ty === y)) sy++;
  }
  return out;
}

// The figure widens or narrows by a mirrored pair of columns.
function widenCols(p, rng, sym) {
  const grow = rng.chance(0.5) || p.w < 5;
  const x = rng.int(1, Math.max(1, Math.floor(p.w / 2) - 1));
  const cols = [];
  for (let sx = 0; sx < p.w; sx++) {
    const isPick = sx === x || (sym && sx === p.w - 1 - x);
    if (grow) { cols.push(sx); if (isPick) cols.push(sx); }
    else if (!isPick) cols.push(sx);
  }
  if (cols.length < 3) return null;
  const out = { w: cols.length, h: p.h, cells: new Uint8Array(cols.length * p.h) };
  for (let y = 0; y < p.h; y++) cols.forEach((sx, tx) => { out.cells[y * out.w + tx] = p.cells[y * p.w + sx]; });
  return out;
}

// Curvilinear softening: convex staircase corners become half-cells.
function soften(p, rng, sym, strength) {
  const out = clonePattern(p);
  const mirrorCode = { 3: 4, 4: 3, 5: 6, 6: 5 };
  let changed = false;
  for (let y = 0; y < p.h; y++) for (let x = 0; x < (sym ? Math.ceil(p.w / 2) : p.w); x++) {
    const c = p.cells[y * p.w + x];
    if (c !== 1 && c !== 2) continue;
    const L = !!cellAt(p, x - 1, y), R = !!cellAt(p, x + 1, y), T = !!cellAt(p, x, y - 1), B = !!cellAt(p, x, y + 1);
    // a convex corner touches filled cells on exactly two adjacent sides
    let missing = -1;
    if (L && B && !T && !R) missing = 1;        // top-right missing
    else if (R && B && !T && !L) missing = 0;   // top-left missing
    else if (L && T && !B && !R) missing = 2;   // bottom-right missing
    else if (R && T && !B && !L) missing = 3;   // bottom-left missing
    if (missing < 0 || !rng.chance(0.35 + 0.5 * strength)) continue;
    const code = HALF_BASE + missing;
    out.cells[y * p.w + x] = code; changed = true;
    if (sym) { const mx = p.w - 1 - x; if (mx !== x) out.cells[y * p.w + mx] = mirrorCode[code]; }
  }
  return changed ? out : null;
}

/**
 * weaverHand(pattern, seed, { handStrength = 0.25, curvilinear = false })
 * → a new pattern with a seeded set of weaver's nudges applied.
 * handStrength 0 returns the base grid untouched; 1 is a very loose hand.
 */
export function weaverHand(pattern, seed, opts = {}) {
  const strength = Math.max(0, Math.min(1, opts.handStrength ?? 0.25));
  const rng = makeRng(seed);
  if (strength === 0) return clonePattern(pattern);
  const sym = isSymmetricH(pattern);
  const baseCount = filledCount(pattern);
  let p = clonePattern(pattern);
  const nOps = 1 + Math.round(strength * 4);
  // limbs and hooks are the common slips; a deeper skirt or a wider figure is rarer
  const ops = [nudgeLimb, nudgeLimb, nudgeLimb, closeHook, skirtRow, widenCols];
  let rowsDelta = 0, colsDelta = 0;
  for (let i = 0; i < nOps; i++) {
    const op = rng.pick(ops);
    if (op === skirtRow && Math.abs(rowsDelta) >= 1) continue;
    if (op === widenCols && Math.abs(colsDelta) >= 2) continue;
    const next = op(p, rng, sym);
    if (!next) continue;
    // never let the hand erase the motif
    if (filledCount(next) < baseCount * 0.8) continue;
    rowsDelta += next.h - p.h; colsDelta += next.w - p.w;
    p = next;
  }
  if (opts.curvilinear) {
    const s = soften(p, rng, sym, strength);
    if (s) p = s;
  }
  return p;
}
