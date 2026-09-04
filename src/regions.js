// regions.js — No. 03, the weaving regions: one row per region, expanding to its
// signature, dyes, compositions, formats, and the motifs its weavers reach for
// (as swatch chips that open the motif in the index).

import { parseGrid } from './motif.js';
import { drawSwatch, makeCanvas } from './swatch.js';
import { openMotif } from './index.js';

const ACCENT = '#C42B1C', INK = '#141414';
let DATA;
const rows = new Map();

function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

export function buildRegions(data, root) {
  DATA = data; root.innerHTML = '';
  for (const r of data.regions.regions) {
    const item = el('div', 'acc-item'); item.id = `region-${r.key}`;
    const panelId = `region-panel-${r.key}`;
    const btn = el('button', 'acc-btn region-btn'); btn.type = 'button';
    btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', panelId);
    const n = r.motif_pool.length;
    btn.innerHTML = `<span class="sign" aria-hidden="true">+</span><span class="title">${r.name}<span class="group">${r.group}</span></span><span class="meta mono">${n} motif${n > 1 ? 's' : ''} · ${r.compositions.length} composition${r.compositions.length > 1 ? 's' : ''}${r.weave === 'cicim' ? ' · cicim' : ''}${r.thinly_sourced ? ' · ⚠ thinly sourced' : ''}</span>`;
    const panel = el('div', 'acc-panel region-detail'); panel.id = panelId; panel.hidden = true;
    let built = false;
    const toggle = (force) => {
      const open = force ?? panel.hidden;
      panel.hidden = !open; btn.setAttribute('aria-expanded', String(open)); btn.querySelector('.sign').textContent = open ? '−' : '+';
      if (open && !built) { build(r, panel); built = true; }
      return open;
    };
    btn.addEventListener('click', () => toggle());
    item.append(btn, panel); root.appendChild(item);
    rows.set(r.key, { item, toggle });
  }
  document.addEventListener('open-region', e => openRegion(e.detail));
}

export function openRegion(key) {
  const r = rows.get(key); if (!r) return;
  r.toggle(true);
  r.item.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

function build(r, panel) {
  const comps = r.compositions.map(k => DATA.compositions[k]?.name || k).join(', ');
  const ratios = r.aspect_ratios.map(k => { const t = DATA.regions.ratios[k]; return t ? `${t.name} ${t.w}:${t.h}` : k; }).join(', ');
  panel.innerHTML = `
    <p class="signature">${r.signature}${r.thinly_sourced ? ' <span class="thin">Regional sources are thin; palette and compositions await validation.</span>' : ''}</p>
    <p class="facts mono">Compositions · ${comps}<br>Formats · ${ratios}<br>Weave · ${r.weave === 'cicim' ? 'cicim, supplementary weft' : 'slit-weave'}</p>
    <div class="dyes mono"></div>
    <p class="facts mono">Motifs woven here · ${r.motif_pool.length}</p>
    <div class="chips"></div>`;
  const dyes = panel.querySelector('.dyes');
  for (const k of r.palette) {
    const d = DATA.dyes[k]; if (!d) continue;
    dyes.appendChild(el('span', 'dye', `<i style="background:${d.hex}"></i>${k.replace(/_/g, ' ')}`));
  }
  const chips = panel.querySelector('.chips');
  for (const key of r.motif_pool) {
    const m = DATA.motifByKey[key]; if (!m) continue;
    const a = el('a', 'chip'); a.href = `#motif-${key}`;
    const c = makeCanvas(`${m.nameTr} glyph`);
    if (m.grid) drawSwatch(c, parseGrid(m.grid), { primary: ACCENT, secondary: INK, size: 28, cellSize: Math.max(1, Math.floor(28 / Math.max(m.typical_size[0], m.typical_size[1]))) });
    a.append(c, el('span', 'tr', m.nameTr), el('span', 'en mono', m.nameEn));
    a.addEventListener('click', e => { e.preventDefault(); openMotif(key, true); });
    chips.appendChild(a);
  }
}
