import type { ParsedFile, Well } from './parse/quantstudio';

/** Deterministic PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(r: () => number) {
  const u = Math.max(r(), 1e-12);
  const v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Synthetic example experiment: two lineages (undifferentiated, "ch" = chondrogenic)
 * x three conditions (WT, KO, KO rescue), 3 biological x 4 technical replicates,
 * two reference genes and three targets (one low-expressed with undetermined wells).
 */
export function makeExampleFile(seed = 42): ParsedFile {
  const r = rng(seed);
  const panels = ['', 'ch'];
  const groups = ['WT', 'KO', 'KOres'];
  const genes: Record<string, { base: number; effect: Record<string, number>; panelEffect: Record<string, number> }> = {
    RPLP0: { base: 20, effect: {}, panelEffect: {} },
    GAPDH: { base: 18, effect: {}, panelEffect: {} },
    LAMA5: { base: 25, effect: { KO: 2.6, KOres: 1.1 }, panelEffect: { ch: -1.5 } },
    COL2A1: { base: 30, effect: { KO: -1.2, KOres: -0.3 }, panelEffect: { ch: -6 } },
    SOX9: { base: 35.6, effect: { KO: 1.5, KOres: 0.4 }, panelEffect: { ch: -3.5 } },
  };
  const wells: Well[] = [];
  let idx = 0;
  for (const p of panels) {
    for (const g of groups) {
      for (let b = 1; b <= 3; b++) {
        const sample = `${p}${g}${b}`;
        const input = gauss(r) * 0.6; // RNA input differences shift all genes
        const bio: Record<string, number> = {};
        for (const [gene, def] of Object.entries(genes)) {
          bio[gene] = def.base + input + (def.effect[g] ?? 0) + (def.panelEffect[p] ?? 0) + gauss(r) * 0.25;
        }
        for (const gene of Object.keys(genes)) {
          for (let t = 0; t < 4; t++) {
            const rowI = Math.floor(idx / 24);
            const colI = idx % 24;
            idx++;
            let ct: number | null = bio[gene] + gauss(r) * 0.12;
            let undetermined = false;
            // a pipetting error and a non-detect for demonstration
            if (sample === 'KO2' && gene === 'LAMA5' && t === 3) ct += 1.6;
            if (gene === 'SOX9' && ct > 37.2) {
              ct = null;
              undetermined = true;
            }
            const position = String.fromCharCode(65 + rowI) + (colI + 1);
            wells.push({
              id: `0:${position}`,
              fileIndex: 0,
              fileName: 'Example experiment',
              position,
              row: rowI,
              col: colI,
              sample,
              target: gene,
              task: 'UNKNOWN',
              reporter: gene === 'RPLP0' ? 'VIC' : 'FAM',
              ct: ct === null ? null : Math.round(ct * 1e5) / 1e5,
              ctRaw: ct === null ? 'Undetermined' : String(ct),
              undetermined,
              omit: false,
              flags: [],
              ampStatus: ct === null ? 'No Amp' : 'Amp',
            });
          }
        }
      }
    }
  }
  return {
    name: 'Example experiment',
    sheetName: 'Results',
    experimentName: 'Example: LAMA5 knockout and rescue (synthetic data)',
    instrument: 'synthetic',
    meta: { 'Experiment Name': 'Example (synthetic data)' },
    endogenousControl: 'RPLP0',
    referenceSample: 'WT1',
    plateFormat: 384,
    wells,
    warnings: [],
  };
}