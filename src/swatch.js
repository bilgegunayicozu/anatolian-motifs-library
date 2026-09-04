// swatch.js — one shared offscreen p5.Graphics buffer that renders motif grids
// for the index glyphs, the variations, and the region chips. Every swatch goes
// through renderMotif → paintMotif, the same path the loom uses; the result is
// copied onto a small per-swatch <canvas>. Nothing is hand-drawn.

import { renderMotif } from './motif.js';
import { paintMotif } from './loom.js';

let buffer = null;     // p5.Graphics, grown on demand
let host = null;       // the p5 instance that owns it

export function initSwatches(p) { host = p; }

function ensureBuffer(w, h) {
  if (!buffer || buffer.width < w || buffer.height < h) {
    const nw = Math.max(w, buffer?.width ?? 0, 256), nh = Math.max(h, buffer?.height ?? 0, 256);
    if (buffer) buffer.remove();
    buffer = host.createGraphics(nw, nh);
    buffer.pixelDensity(1);
    buffer.noSmooth();
  }
  return buffer;
}

/**
 * Render a pattern into `canvas` (an HTMLCanvasElement) at up to `size` px.
 * opts: { primary, secondary, ground, slits, cellSize (override), pad }
 */
export function drawSwatch(canvas, pattern, opts = {}) {
  const size = opts.size ?? 96;
  const cs = opts.cellSize ?? Math.max(1, Math.floor(size / Math.max(pattern.w, pattern.h)));
  const w = pattern.w * cs, h = pattern.h * cs;
  const g = ensureBuffer(w, h);
  g.push();
  g.clear();
  if (opts.ground) { g.noStroke(); g.fill(opts.ground); g.rect(0, 0, w, h); }
  const rendered = renderMotif(pattern, opts.primary ?? '#C42B1C', opts.secondary ?? '#141414');
  paintMotif(g, rendered, { cellSize: cs, x0: 0, y0: 0, slits: !!opts.slits });
  g.pop();
  canvas.width = w; canvas.height = h;
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(g.elt, 0, 0, w, h, 0, 0, w, h);
  return canvas;
}

/** A tiny canvas element ready for drawSwatch. */
export function makeCanvas(label) {
  const c = document.createElement('canvas');
  c.setAttribute('role', 'img');
  if (label) c.setAttribute('aria-label', label);
  return c;
}
