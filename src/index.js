// index.js — No. 02, the motif index: an accordion of categories → motif rows →
// expanded detail with meaning, regions and the variations (§4):
//   1. weaver's hand   — the base grid through weaverHand at several seeds
//   2. regional dyes   — the grid in the palettes of regions that weave it
//   3. documented forms — the auto-traced variants from the printed catalog
// Variation swatches render lazily on first expand and are cached.

import { parseGrid } from './motif.js';
import { weaverHand } from './weaverhand.js';
import { swatchPalette } from './palette.js';
import { makeRng, hashString } from './rng.js';
import { drawSwatch, makeCanvas } from './swatch.js';

const ACCENT = '#C42B1C', INK = '#141414';
const HAND_SEEDS = 5, PAGE = 24;
let DATA, ROOT;
const rows = new Map();          // key → { item, btn, detail, built, motif }
const variantCache = new Map();  // key → promise of variants json
const strengthStep = v => Math.round(v * 20) / 20;

export function buildIndex(data, root) {
  DATA = data; ROOT = root;
  root.innerHTML = '';
  for (const cat of data.motifs.categories) {
    const motifs = data.motifs.motifs.filter(m => m.category === cat.key);
    if (!motifs.length) continue;
    const item = el('div', 'acc-item');
    const panelId = `cat-${cat.key}`;
    const btn = el('button', 'acc-btn');
    btn.type = 'button'; btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', panelId);
    btn.innerHTML = `<span class="sign" aria-hidden="true">+</span><span class="title">${cat.name}<span class="tr">${cat.tr}</span></span><span class="meta mono">${motifs.length} motif${motifs.length > 1 ? 's' : ''} · ${cat.note}</span>`;
    const panel = el('div', 'acc-panel'); panel.id = panelId; panel.hidden = true;
    btn.addEventListener('click', () => toggle(btn, panel));
    for (const m of motifs) panel.appendChild(motifRow(m));
    item.append(btn, panel); root.appendChild(item);
  }
}

function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
function toggle(btn, panel, force) {
  const open = force ?? panel.hidden;
  panel.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
  btn.querySelector('.sign').textContent = open ? '−' : '+';
  return open;
}

function regionName(k) { return DATA.regionByKey[k]?.name || k; }

function motifRow(m) {
  const row = el('div', 'motif-row'); row.id = `motif-${m.key}`;
  const btn = el('button', 'motif-btn'); btn.type = 'button';
  const detailId = `detail-${m.key}`;
  btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', detailId);
  const glyph = el('span', 'glyph');
  const c = makeCanvas(`${m.nameTr} motif grid`);
  if (m.grid) drawSwatch(c, parseGrid(m.grid), { primary: ACCENT, secondary: INK, size: 52, cellSize: Math.max(2, Math.floor(52 / Math.max(m.typical_size[0], m.typical_size[1]))) });
  glyph.appendChild(c);
  const name = el('span', 'name', `${m.nameTr}<span class="gloss">${m.nameEn}${m.curvilinear ? ' · curvilinear' : ''}</span>`);
  const sign = el('span', 'sign', '+'); sign.setAttribute('aria-hidden', 'true');
  btn.append(glyph, name, sign);
  const detail = el('div', 'motif-detail'); detail.id = detailId; detail.hidden = true;
  btn.addEventListener('click', () => {
    const open = !detail.hidden ? false : true;
    detail.hidden = !open; btn.setAttribute('aria-expanded', String(open)); sign.textContent = open ? '−' : '+';
    if (open) { buildDetail(m, detail); history.replaceState(null, '', `#motif=${m.key}`); }
  });
  row.append(btn, detail);
  rows.set(m.key, { item: row, btn, detail, motif: m, built: false, sign });
  return row;
}

/** Open a motif by key (deep link / region chip). Expands its category and scrolls to it. */
export function openMotif(key, scroll) {
  const r = rows.get(key); if (!r) return;
  const catPanel = r.item.parentElement, catBtn = catPanel.previousElementSibling;
  toggle(catBtn, catPanel, true);
  if (r.detail.hidden) { r.detail.hidden = false; r.btn.setAttribute('aria-expanded', 'true'); r.sign.textContent = '−'; buildDetail(r.motif, r.detail); }
  if (scroll) r.item.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  r.btn.focus({ preventScroll: true });
}

/* ------------------------------------------------------------- detail */
function buildDetail(m, detail) {
  const r = rows.get(m.key);
  if (r.built) return;
  r.built = true;
  const regions = m.regions.length ? m.regions : [];
  const documented = (m.regions_documented || []).filter(k => !regions.includes(k));
  detail.innerHTML = `
    <p class="meaning">${m.meaning}</p>
    <p class="regions mono">${regions.length ? 'Woven in ' + regions.map(k => `<a href="#region-${k}" data-region="${k}">${regionName(k)}</a>`).join(', ') : 'Not in a regional pool of the research catalog'}${documented.length ? `<br>Also recorded in ${documented.map(k => `<a href="#region-${k}" data-region="${k}">${regionName(k)}</a>`).join(', ')}` : ''}</p>
    <p class="facts mono">Grid ${m.typical_size[0]} × ${m.typical_size[1]} cells${m.variant_count ? ` · ${m.variant_count} documented variants` : ''}${m.variant_techniques?.length ? ` · ${m.variant_techniques.slice(0, 4).join(', ')}` : ''}${m.grid_source ? ` · base grid seeded from ${m.grid_source}` : ''}</p>`;
  detail.querySelectorAll('a[data-region]').forEach(a => a.addEventListener('click', e => {
    e.preventDefault(); document.dispatchEvent(new CustomEvent('open-region', { detail: a.dataset.region }));
  }));
  if (!m.grid) return;
  const base = parseGrid(m.grid);
  detail.appendChild(handGroup(m, base));
  detail.appendChild(dyeGroup(m, base));
  detail.appendChild(formsGroup(m, base));
}

function group(k, h, n) {
  const g = el('div', 'var-group');
  g.innerHTML = `<div class="var-head"><span class="k mono">${k}</span><span class="h">${h}</span>${n ? `<span class="n mono">${n}</span>` : ''}</div>`;
  return g;
}
function swatch(caption, pending) {
  const s = el('div', 'swatch' + (pending ? ' pending' : ''));
  const box = el('div', 'box'); const c = makeCanvas(caption.replace(/<[^>]+>/g, ' '));
  box.appendChild(c);
  const cap = el('div', 'cap mono', caption);
  s.append(box, cap);
  return { el: s, canvas: c };
}

/* 1. weaver's hand */
function handGroup(m, base) {
  const g = group('Variations · I', "Weaver's hand", `${HAND_SEEDS} seeds`);
  const ctl = el('div', 'hand-control mono');
  ctl.innerHTML = `<label for="hand-${m.key}">hand strength</label><input id="hand-${m.key}" type="range" min="0" max="1" step="0.05" value="0.25" aria-label="Hand strength: how loosely the weaver follows the grid"><output for="hand-${m.key}">0.25</output>`;
  const strip = el('div', 'var-strip');
  const cache = new Map();
  const render = (strength) => {
    strip.innerHTML = '';
    for (let i = 0; i < HAND_SEEDS; i++) {
      const seed = (hashString(m.key) + i * 7919) >>> 0;
      const key = `${strengthStep(strength)}|${seed}`;
      let pat = cache.get(key);
      if (!pat) { pat = weaverHand(base, seed, { handStrength: strengthStep(strength), curvilinear: m.curvilinear }); cache.set(key, pat); }
      const s = swatch(`seed <b>${seed}</b><br>${pat.w} × ${pat.h}`);
      drawSwatch(s.canvas, pat, { primary: ACCENT, secondary: INK, size: 96 });
      strip.appendChild(s.el);
    }
  };
  const input = ctl.querySelector('input'), out = ctl.querySelector('output');
  let t = null;
  input.addEventListener('input', () => { out.textContent = Number(input.value).toFixed(2); clearTimeout(t); t = setTimeout(() => render(Number(input.value)), 60); });
  g.append(ctl, strip);
  render(0.25);
  return g;
}

/* 2. regional dyes */
function dyeGroup(m, base) {
  const keys = (m.regions.length ? m.regions : (m.regions_documented || [])).slice(0, 3);
  const g = group('Variations · II', 'Regional dyes', keys.length ? `${keys.length} palettes` : '');
  const strip = el('div', 'var-strip');
  if (!keys.length) strip.appendChild(el('p', 'trace-note mono', 'No regional palette recorded for this motif.'));
  keys.forEach(k => {
    const region = DATA.regionByKey[k]; if (!region) return;
    const pal = swatchPalette(region, DATA.dyes, makeRng(hashString(m.key + k)));
    const s = swatch(`<b>${region.name}</b><br>${[pal.ground, pal.primary].map(h => dyeName(h)).join(' · ')}`);
    drawSwatch(s.canvas, base, { primary: pal.primary, secondary: pal.secondary, ground: pal.ground, size: 96, slits: true });
    strip.appendChild(s.el);
  });
  g.appendChild(strip);
  return g;
}
function dyeName(hex) {
  const e = Object.entries(DATA.dyes).find(([, v]) => v.hex.toLowerCase() === hex.toLowerCase());
  return e ? e[0].replace(/_/g, ' ') : hex;
}

/* 3. documented forms */
function formsGroup(m, base) {
  const g = group('Variations · III', 'Documented forms', m.variant_count ? `${m.variant_count} in the printed catalog` : '');
  if (m.variations_note) g.appendChild(el('p', 'var-note', m.variations_note));
  if (!m.variant_count) {
    g.appendChild(el('p', 'trace-note mono', 'No traced variants for this motif yet — the base grid follows the research reference.'));
    return g;
  }
  const strip = el('div', 'var-strip');
  const note = el('p', 'trace-note mono', 'Auto-traced from Erbek, pending validation against the printed page. Entries marked ✓ have been hand-checked.');
  const more = el('button', 'btn mono more', 'Show more'); more.type = 'button';
  g.append(strip, note, more);
  let shown = 0, variants = null;
  const showNext = () => {
    const slice = variants.slice(shown, shown + PAGE);
    for (const v of slice) {
      const pat = parseGrid(v.grid);
      const where = [v.technique, v.province || (v.region ? regionName(v.region) : null)].filter(Boolean).join(' · ');
      const s = swatch(`<b>no. ${String(v.no).padStart(3, '0')}</b> ${v.validated ? '✓' : ''}<br>${where}<br>p.${v.page} · ${v.w} × ${v.h}${v.twoTone ? ' · two-colour' : ''}`, !v.validated);
      drawSwatch(s.canvas, pat, { primary: ACCENT, secondary: INK, size: 104 });
      strip.appendChild(s.el);
    }
    shown += slice.length;
    more.hidden = shown >= variants.length;
    more.textContent = `Show more · ${variants.length - shown} remaining`;
  };
  more.addEventListener('click', showNext);
  more.disabled = true; more.textContent = 'Loading…';
  loadVariants(m.key).then(vs => { variants = vs; more.disabled = false; showNext(); })
    .catch(() => { more.hidden = true; note.textContent = 'The variant file could not be loaded.'; });
  return g;
}

function loadVariants(key) {
  if (!variantCache.has(key)) {
    const inline = window.__KILIM_VARIANTS__ && window.__KILIM_VARIANTS__[key];
    if (inline) variantCache.set(key, Promise.resolve(inline.variants));
    else variantCache.set(key, fetch(`./data/variants/${key}.json`).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }).then(j => j.variants));
  }
  return variantCache.get(key);
}
