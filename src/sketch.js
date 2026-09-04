// sketch.js — entry point. Loads the data layer, mounts the live specimen (p5),
// wires the accession block, actions and permalink, then builds the motif index
// and the region catalog.

import { loadData, weave, describe, title } from './generator.js';
import { paintLoom } from './loom.js';
import { makeRng, freshSeed, normaliseSeed } from './rng.js';
import { initSwatches } from './swatch.js';
import { buildIndex, openMotif } from './index.js';
import { buildRegions } from './regions.js';

const $ = id => document.getElementById(id);
const REGION_NAMES = {};

let data, spec, p5inst;
let cellSize = 6, plateW = 0, plateH = 0;
let pinned = null;
let resolveReady; const loomReady = new Promise(r => { resolveReady = r; });

function readUrl() {
  const u = new URL(location.href);
  return { region: u.searchParams.get('region') || '', seed: u.searchParams.get('seed') || '' };
}
function writeUrl() {
  const u = new URL(location.href);
  u.searchParams.set('region', spec.region.key);
  u.searchParams.set('seed', String(spec.seed));
  history.replaceState(null, '', u.pathname + u.search + u.hash);
}

/* ------------------------------------------------------------ accession */
function fillAccession() {
  $('acc-number').textContent = `ACCESSION ${spec.accession}`;
  $('acc-region').textContent = `${spec.region.name} · ${spec.region.group}`;
  $('acc-composition').textContent = `${spec.comp.name} · ${spec.comp.en}`;
  $('acc-format').textContent = `${spec.ratio.name} · ${spec.ratio.en} · ${spec.ratio.w}:${spec.ratio.h}`;
  $('acc-palette').textContent = [spec.palette.groundKey, ...spec.palette.keys].map(k => k.replace(/_/g, ' ')).join(' · ');
  $('acc-inventory').textContent = spec.inventory.map(i => `${i.motif ? i.motif.nameTr : i.key} ×${i.n}`).join(' · ') || '—';
  $('acc-loom').textContent = `${spec.loomCount} cells · ${spec.gridW * spec.gridH} knots`;
  $('acc-weave').textContent = spec.weave === 'cicim' ? 'cicim · supplementary weft, raised' : 'slit-weave · flat';
  $('acc-seed').textContent = String(spec.seed);
  $('spec-title').textContent = title(spec);
  $('spec-desc').textContent = describe(spec, data.dyes);
  $('specimen-count').textContent = `${spec.placements.length} motifs placed · seed ${spec.seed}`;
  document.title = `${spec.accession} — Digital Library of Anatolian Motifs`;
  writeUrl();
}

/* ------------------------------------------------------------ the loom */
function sizePlate() {
  const stage = $('stage');
  const avail = Math.max(120, stage.clientWidth - parseFloat(getComputedStyle(stage).paddingLeft) * 2);
  // portrait specimens are capped by a comfortable height as well
  const maxH = Math.max(320, Math.min(window.innerHeight * 0.82, 900));
  cellSize = Math.max(2, Math.min(Math.floor(avail / spec.gridW), Math.floor(maxH / spec.gridH), 10));
  plateW = cellSize * spec.gridW; plateH = cellSize * spec.gridH;
}

function sketch(p) {
  p5inst = p;
  p.setup = () => {
    sizePlate();
    const c = p.createCanvas(plateW, plateH);
    c.parent('stage');
    p.pixelDensity(Math.min(2, window.devicePixelRatio || 1));
    p.noSmooth();
    p.noLoop();
    initSwatches(p);
    c.elt.setAttribute('aria-label', 'Woven kilim specimen');
    c.elt.setAttribute('role', 'img');
    resolveReady();
  };
  p.draw = () => {
    p.background('#ffffff');
    paintLoom(p, spec.loom, {
      cellSize, x0: 0, y0: 0, seed: spec.seed, rng: spec.rng,
      aging: true, fray: true, weave: spec.weave, paper: '#ffffff', ivory: data.dyes.ivory_wool.hex,
    });
  };
  p.mouseMoved = () => hover(p.mouseX, p.mouseY, false);
  p.mousePressed = () => { if (inside(p.mouseX, p.mouseY)) hover(p.mouseX, p.mouseY, true); };
  p.windowResized = () => {
    const before = cellSize; sizePlate();
    if (cellSize !== before) { p.resizeCanvas(plateW, plateH); p.redraw(); }
  };
}
const inside = (mx, my) => mx >= 0 && my >= 0 && mx < plateW && my < plateH;

function placementAt(mx, my) {
  const gx = Math.floor(mx / cellSize), gy = Math.floor(my / cellSize);
  if (gx < 0 || gy < 0 || gx >= spec.gridW || gy >= spec.gridH) return null;
  const idx = spec.loom.motif[gy * spec.gridW + gx];
  if (!idx) return null;
  return spec.placements.find(pl => pl.index === idx) || null;
}

function hover(mx, my, tap) {
  const label = $('hover-label');
  const pl = inside(mx, my) ? placementAt(mx, my) : null;
  if (tap) { pinned = pl && pinned && pinned.index === pl.index ? null : pl; }
  const show = pinned || pl;
  if (!show) { label.hidden = true; return; }
  const m = data.motifByKey[show.key];
  if (!m) { label.hidden = true; return; }
  label.innerHTML = `<span class="tr">${m.nameTr}</span><span class="en">${m.nameEn}${show.border ? ' · border' : ''}${show.scale > 1 ? ` · ${show.scale}× scale` : ''}</span><span class="meaning">${m.meaning}</span>`;
  label.hidden = false;
  // position near the cursor, inside the plate
  const plate = $('stage').getBoundingClientRect(), fig = $('stage').parentElement.getBoundingClientRect();
  const canvas = $('stage').querySelector('canvas').getBoundingClientRect();
  let lx = canvas.left - fig.left + mx + 14, ly = canvas.top - fig.top + my + 14;
  if (lx + 250 > fig.width) lx = Math.max(0, lx - 270);
  if (ly + 90 > fig.height) ly = Math.max(0, ly - 100);
  label.style.left = lx + 'px'; label.style.top = ly + 'px';
}

function reweave(opts) {
  spec = weave(data, opts);
  pinned = null; $('hover-label').hidden = true;
  fillAccession();
  if (p5inst) {
    const before = cellSize; sizePlate();
    if (cellSize !== before || p5inst.width !== plateW || p5inst.height !== plateH) p5inst.resizeCanvas(plateW, plateH);
    p5inst.redraw();
  }
}

function savePlate() {
  // export at a fixed 8px cell so the plate is crisp regardless of screen size
  const cs = 8, pad = 48;
  const g = p5inst.createGraphics(spec.gridW * cs + pad * 2, spec.gridH * cs + pad * 2 + 40);
  g.pixelDensity(1); g.noSmooth();
  g.background('#ffffff');
  paintLoom(g, spec.loom, { cellSize: cs, x0: pad, y0: pad, seed: spec.seed, rng: spec.rng, aging: true, fray: true, weave: spec.weave, paper: '#ffffff', ivory: data.dyes.ivory_wool.hex });
  g.noStroke(); g.fill('#141414'); g.textFont('monospace'); g.textSize(13);
  g.text(`${spec.accession} · ${spec.region.name} · ${spec.comp.name} · seed ${spec.seed} · Digital Library of Anatolian Motifs`, pad, g.height - 18);
  g.stroke('#141414'); g.noFill(); g.rect(pad - 1, pad - 1, spec.gridW * cs + 2, spec.gridH * cs + 2);
  p5inst.saveCanvas(g, `kilim-${spec.accession.replace(/·/g, '-')}-${spec.seed}`, 'png');
  setTimeout(() => g.remove(), 500);
}

/* ------------------------------------------------------------ boot */
async function boot() {
  data = await loadData('./data/');
  for (const r of data.regions.regions) REGION_NAMES[r.key] = r.name;

  // region select
  const sel = $('sel-region');
  for (const r of data.regions.regions) {
    const o = document.createElement('option'); o.value = r.key; o.textContent = r.name; sel.appendChild(o);
  }
  const q = readUrl();
  if (q.region && data.regionByKey[q.region]) sel.value = q.region;
  spec = weave(data, { region: q.region || undefined, seed: q.seed ? normaliseSeed(q.seed) : undefined });
  fillAccession();
  new p5(sketch);
  await loomReady;   // the swatch buffer needs the p5 instance from setup()

  $('btn-weave').addEventListener('click', () => reweave({ region: sel.value || undefined, seed: freshSeed() }));
  $('btn-save').addEventListener('click', savePlate);
  sel.addEventListener('change', () => reweave({ region: sel.value || undefined, seed: freshSeed() }));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { pinned = null; $('hover-label').hidden = true; } });

  buildIndex(data, $('motif-accordion'));
  buildRegions(data, $('region-accordion'));

  const nV = data.motifs.motifs.reduce((a, m) => a + (m.variant_count || 0), 0);
  $('index-count').textContent = `${data.motifs.motifs.length} catalogued motifs · ${nV.toLocaleString('en')} variants · tap to open`;
  $('regions-count').textContent = `${data.regions.regions.length} regions · tap to open`;
  $('colophon-sizes').textContent = `Catalog: ${data.motifs.motifs.length} motifs in ${data.motifs.categories.length} categories · ${nV.toLocaleString('en')} documented variants · ${data.regions.regions.length} weaving regions · ${Object.keys(data.compositions).length} compositions · ${Object.keys(data.dyes).length} natural dyes.`;

  // deep link: #motif=elibelinde
  const openFromHash = () => {
    const m = location.hash.match(/#motif=([a-z0-9-]+)/i);
    if (m) openMotif(m[1], true);
  };
  window.addEventListener('hashchange', openFromHash);
  openFromHash();
}

boot().catch(err => {
  console.error(err);
  $('spec-desc').textContent = 'The catalog could not be loaded. Serve the site over http(s) — for example `python3 -m http.server` — so the data files can be fetched.';
});
