// Headless sanity test: weave every region × composition and print ASCII plates.
//   node tools/test-weave.mjs [regionKey] [seed]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGrid } from '../src/motif.js';
import { weave, describe } from '../src/generator.js';
import { weaverHand } from '../src/weaverhand.js';
import { gridToRows } from '../src/motif.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const J = f => JSON.parse(fs.readFileSync(path.join(root, 'data', f), 'utf8'));
const motifs = J('motifs.json'), regions = J('regions.json'), compositions = J('compositions.json'), dyes = J('dyes.json');
const patterns = {}; for (const m of motifs.motifs) if (m.grid) patterns[m.key] = parseGrid(m.grid);
const data = { motifs, regions, compositions, dyes, patterns,
  motifByKey: Object.fromEntries(motifs.motifs.map(m => [m.key, m])),
  regionByKey: Object.fromEntries(regions.regions.map(r => [r.key, r])) };

const [, , regionArg, seedArg] = process.argv;
if (regionArg) {
  const spec = weave(data, { region: regionArg, seed: seedArg || 4827193 });
  console.log(spec.accession, spec.region.name, spec.compKey, spec.ratioKey, spec.loomCount, 'placements', spec.placements.length);
  console.log(describe(spec, dyes));
  const cols = Object.fromEntries([spec.palette.ground, ...spec.palette.colours].map((c, i) => [c, ' .:-=+*#%@'[i] || '?']));
  for (let y = 0; y < spec.loom.h; y += 2) {
    let s = '';
    for (let x = 0; x < spec.loom.w; x++) { const v = spec.loom.colour[y * spec.loom.w + x]; s += cols[typeof v === 'object' ? v.c : v] ?? '?'; }
    console.log(s);
  }
} else {
  let n = 0, bad = 0;
  for (const r of regions.regions) for (const c of r.compositions) {
    for (let s = 1; s <= 3; s++) {
      try {
        const rng = { seed: s };
        // force the composition by trying seeds until it matches
        let spec, tries = 0;
        do { spec = weave(data, { region: r.key, seed: s * 1000 + tries }); tries++; } while (spec.compKey !== c && tries < 60);
        if (spec.compKey !== c) { console.log('could not hit', r.key, c); continue; }
        n++;
        const filled = spec.placements.filter(p => !p.border).length;
        if (filled === 0 && c !== 'bos-gobek') { console.log('NO FIELD MOTIFS', r.key, c, spec.seed); bad++; }
        const inv = spec.inventory.map(i => i.key + '×' + i.n).join(' ');
        if (s === 1) console.log(`${r.key.padEnd(12)} ${c.padEnd(12)} ${spec.ratioKey.padEnd(9)} ${spec.loomCount.padEnd(9)} ${inv}`);
      } catch (e) { bad++; console.log('ERROR', r.key, c, e.stack.split('\n').slice(0, 3).join(' | ')); }
    }
  }
  console.log(`${n} weaves, ${bad} problems`);
  // weaverHand check
  const p = patterns.elibelinde;
  for (const s of [1, 2, 3]) console.log(gridToRows(weaverHand(p, s, { handStrength: 0.6 })).join('\n') + '\n');
  console.log(gridToRows(weaverHand(patterns.karanfil, 5, { handStrength: 0.5, curvilinear: true })).join('\n'));
}
