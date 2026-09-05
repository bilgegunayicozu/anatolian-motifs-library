// generator.js — picks region → aspect ratio → composition → palette → motifs,
// and weaves a specimen. Owns the seeded RNG for a weave; every other module
// receives its randomness from here.

import { makeRng, normaliseSeed, freshSeed } from './rng.js';
import { parseGrid } from './motif.js';
import { regionPalette } from './palette.js';
import { weaveComposition } from './composition.js';

const REGION_CODES = {
  konya: 'KNY', karapinar: 'KRP', cappadocia: 'KAP', kirsehir: 'KSH', sivrihisar: 'SVH',
  manisa: 'MNS', aydin: 'AYD', usak: 'USK', bergama: 'BRG', milas: 'MLS', balikesir: 'BLK',
  kars: 'KAR', erzurum: 'ERZ', van: 'VAN', sivas: 'SVS', malatya: 'MLT', gaziantep: 'GZT',
  adiyaman: 'ADY', dosemealti: 'DSM', 'fethiye-mut': 'FTM',
};

// Short side in loom cells per aspect ratio (a typical loom is 80–140 cells wide).
// Both loom dimensions are kept ODD so a motif of odd width — most of them — can sit
// exactly on the centre column or row; on an even loom the mirror axis falls between
// two cells and reflecting the field would shave a cell off every centred motif.
const SHORT_SIDE = { namazlik: 79, yolluk: 55, sergi: 85, buyuk: 93, heybe: 73 };
const odd = n => (n % 2 === 0 ? n + 1 : n);

/** Load the whole data layer once. Paths are relative so the site works under /repo/. */
export async function loadData(base = './data/') {
  // a self-contained preview build inlines the data layer as window.__KILIM_DATA__
  const inline = typeof window !== 'undefined' && window.__KILIM_DATA__;
  const get = async f => inline ? inline[f] : (await fetch(base + f)).json();
  const [motifs, regions, compositions, dyes] = await Promise.all([
    get('motifs.json'), get('regions.json'), get('compositions.json'), get('dyes.json'),
  ]);
  const patterns = {};
  for (const m of motifs.motifs) if (m.grid) patterns[m.key] = parseGrid(m.grid);
  const motifByKey = Object.fromEntries(motifs.motifs.map(m => [m.key, m]));
  const regionByKey = Object.fromEntries(regions.regions.map(r => [r.key, r]));
  return { motifs, regions, compositions, dyes, patterns, motifByKey, regionByKey };
}

/**
 * weave(data, { seed, region }) → specimen
 * A specimen is deterministic for (seed, region): the same seed always re-weaves the same kilim.
 */
export function weave(data, opts = {}) {
  const seed = normaliseSeed(opts.seed ?? freshSeed()) || 1;
  const rng = makeRng(seed);
  const regions = data.regions.regions;

  const region = (opts.region && data.regionByKey[opts.region]) || rng.pick(regions);
  const ratioKey = rng.pick(region.aspect_ratios);
  const ratio = data.regions.ratios[ratioKey];
  const compKey = rng.pick(region.compositions);
  const comp = data.compositions[compKey];

  const short = SHORT_SIDE[ratioKey] ?? 85;
  const gridW = odd(short), gridH = odd(Math.round(short * ratio.h / ratio.w));

  const palette = regionPalette(region, data.dyes, rng.fork('palette'));
  const pool = region.motif_pool.filter(k => data.patterns[k]);

  const woven = weaveComposition({ comp, palette, patterns: data.patterns, pool, rng: rng.fork('field'), gridW, gridH });

  // inventory: which motifs were actually woven, and how many times
  const counts = {};
  for (const p of woven.placements) counts[p.key] = (counts[p.key] || 0) + 1;
  const inventory = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([key, n]) => ({ key, n, motif: data.motifByKey[key] }));

  const code = REGION_CODES[region.key] || region.key.slice(0, 3).toUpperCase();
  const accession = `TR·${code}·${String(seed % 10000).padStart(4, '0')}`;

  return {
    seed, rng, region, ratioKey, ratio, compKey, comp, palette, pool,
    gridW, gridH, loom: woven.loom, placements: woven.placements, field: woven.field,
    inventory, accession, weave: region.weave || 'slit',
    loomCount: `${gridW} × ${gridH}`,
  };
}

/** A curator's one-paragraph description built from the specimen's real facts. */
export function describe(spec, dyes) {
  const dyeName = k => k.replace(/_/g, ' ');
  const inv = spec.inventory.filter(i => i.motif);
  const main = inv.slice(0, 3).map(i => `${i.motif.nameTr} (${i.motif.nameEn.toLowerCase()})`);
  const ground = dyeName(spec.palette.groundKey);
  const figures = spec.palette.keys.slice(0, 3).map(dyeName);
  const list = arr => arr.length <= 1 ? arr.join('') : arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1];
  const weaveNote = spec.weave === 'cicim' ? ' The motifs are laid in cicim, a supplementary weft that sits proud of the ground.' : '';
  return `A ${spec.region.name} ${spec.ratio.en} (${spec.ratio.name.toLowerCase()}) in the ${spec.comp.name.toLowerCase()} manner — ${spec.comp.en}. ` +
    `Woven on ${ground} with ${list(figures)}; the field carries ${list(main)}.` + weaveNote;
}

/** Name for the specimen title line. */
export function title(spec) {
  return `${spec.comp.name} ${spec.ratio.name.toLowerCase()}, ${spec.region.name}`;
}
