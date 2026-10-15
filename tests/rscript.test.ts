/**
 * End-to-end validation: the generated R script must reproduce every summary
 * value and p-value computed by the app. Requires Rscript (set RSCRIPT or have it on PATH).
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeExampleFile } from '../src/lib/example';
import { autoDesign, type Design } from '../src/lib/analysis/design';
import { parseQuantStudio, type ParsedFile } from '../src/lib/parse/quantstudio';
import { runAnalysis } from '../src/lib/analysis/pipeline';
import { DEFAULT_SETTINGS, type Settings } from '../src/lib/analysis/types';
import { generateRScript } from '../src/lib/export/rscript';

const candidates = [process.env.RSCRIPT, 'C:/Program Files/R/R-4.4.3/bin/Rscript.exe', 'Rscript'].filter(Boolean) as string[];
const rscript = candidates.find((c) => {
  try {
    execFileSync(c, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
});

function readCsv(path: string): Record<string, string>[] {
  const lines = readFileSync(path, 'utf8').trim().split(/\r?\n/);
  const parse = (l: string) => {
    const out: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (inQ) {
        if (ch === '"' && l[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') inQ = false;
        else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ',') {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const head = parse(lines[0]);
  return lines.slice(1).map((l) => {
    const v = parse(l);
    return Object.fromEntries(head.map((h, i) => [h, v[i]]));
  });
}

const file = makeExampleFile();
const design = autoDesign(file.wells);
const base: Settings = {
  ...DEFAULT_SETTINGS,
  hkGenes: ['RPLP0'],
  targetGenes: ['LAMA5', 'COL2A1', 'SOX9'],
  referenceGroup: 'WT',
};

const scenarios: [string, Partial<Settings>][] = [
  ['Welch vs reference', {}],
  ['Welch all pairs (Games-Howell)', { comparisons: 'allPairs' }],
  ['classic all pairs (Tukey)', { testFamily: 'classic', comparisons: 'allPairs' }],
  ['classic vs reference (Dunnett)', { testFamily: 'classic' }],
  ['paired vs reference', { testFamily: 'paired' }],
  ['two HK genes, efficiencies, impute ND, pooled reference', {
    hkGenes: ['RPLP0', 'GAPDH'],
    efficiencies: { LAMA5: 94, RPLP0: 98, GAPDH: 103, SOX9: 88 },
    ndSampleMode: 'impute',
    referenceScope: 'pooled',
    multiGeneCorrection: 'BH',
  }],
  ['two groups only', { comparisons: 'vsReference' }],
];

function validateAgainstR(f: ParsedFile, d: Design, s: Settings) {
  {
    {
      const res = runAnalysis(f.wells, d, s);
      const dir = mkdtempSync(join(tmpdir(), 'qpcr-r-'));
      writeFileSync(join(dir, 'analysis.R'), generateRScript([f], d, s, res, 'test'));
      execFileSync(rscript!, ['analysis.R'], { cwd: dir, stdio: 'pipe' });

      const summary = readCsv(join(dir, 'qpcr_group_summary.csv'));
      expect(summary.length).toBe(res.summaries.length);
      for (const g of res.summaries) {
        const row = summary.find((r) => r.target === g.target && r.panel === g.panel && r.group === g.group);
        expect(row, `${g.target}/${g.panel}/${g.group}`).toBeDefined();
        expect(Number(row!.n)).toBe(g.n);
        expect(Math.abs(Number(row!.mean_dCt) - g.meanDct)).toBeLessThan(1e-9);
        // no reference available: both report a missing value (NaN in the app, NA in R)
        if (Number.isNaN(g.rq)) expect(row!.RQ).toBe('NA');
        else expect(Math.abs(Number(row!.RQ) - g.rq) / g.rq).toBeLessThan(1e-9);
      }

      const stats = readCsv(join(dir, 'qpcr_statistics.csv'));
      const comps = res.stats.flatMap((p) => p.comparisons.map((c) => ({ ...c, target: p.target, panel: p.panel })));
      expect(stats.length).toBe(comps.length);
      for (const c of comps) {
        const row = stats.find(
          (r) => r.target === c.target && r.panel === c.panel && r.group1 === c.group1 && r.group2 === c.group2,
        );
        expect(row, `${c.target}/${c.panel}/${c.group1}-${c.group2}`).toBeDefined();
        expect(Math.abs(Number(row!.diff_dCt) - c.diffDct)).toBeLessThan(1e-9);
        // multcomp's Dunnett p-values are computed by randomized quasi-Monte Carlo (abseps 1e-3)
        const tol = c.method.startsWith('Dunnett') ? 2e-3 : 1e-7;
        expect(Math.abs(Number(row!.p_adj) - c.pAdj)).toBeLessThan(tol);
        if (row!.p_final !== undefined) expect(Math.abs(Number(row!.p_final) - c.pFinal)).toBeLessThan(tol);
      }
    }
  }
}

describe.skipIf(!rscript)('generated R script reproduces app results', () => {
  for (const [name, patch] of scenarios) {
    it(name, () => {
      const d =
        name === 'two groups only'
          ? { ...design, conditions: design.conditions.map((c) => ({ ...c, include: c.group !== 'KOres' })) }
          : design;
      validateAgainstR(file, d, { ...base, ...patch });
    }, 60000);
  }
});

const dataDir = process.env.QPCR_DATA_DIR;
const realFiles = dataDir && existsSync(dataDir) ? readdirSync(dataDir).filter((x) => /\.xlsx$/i.test(x)) : [];
describe.skipIf(!rscript || realFiles.length === 0)('generated R script on real exports', () => {
  for (const name of realFiles) {
    for (const [label, patch] of [
      ['Welch', {}],
      ['classic all pairs, impute', { testFamily: 'classic', comparisons: 'allPairs', ndSampleMode: 'impute' }],
    ] as [string, Partial<Settings>][]) {
      it(`${name}: ${label}`, () => {
        const buf = readFileSync(join(dataDir!, name));
        const f = parseQuantStudio(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), name);
        const d = autoDesign(f.wells);
        const targets = [...new Set(f.wells.map((w) => w.target))];
        const groups = [...new Set(d.conditions.map((c) => c.group))];
        validateAgainstR(f, d, {
          ...DEFAULT_SETTINGS,
          hkGenes: ['RPLP0'],
          targetGenes: targets.filter((t) => t !== 'RPLP0'),
          referenceGroup: groups.includes('WT') ? 'WT' : groups[0],
          ...patch,
        });
      }, 60000);
    }
  }
});

describe('example data', () => {
  it('auto-detects panels and groups', () => {
    const groups = [...new Set(design.conditions.map((c) => c.group))];
    const panels = [...new Set(design.conditions.map((c) => c.panel))];
    expect(groups.sort()).toEqual(['KO', 'KOres', 'WT']);
    expect(panels.sort()).toEqual(['', 'ch']);
  });
  it('flags the planted technical outlier', () => {
    const res = runAnalysis(file.wells, design, base);
    const st = res.sampleTargets.find((x) => x.sample === 'KO2' && x.target === 'LAMA5')!;
    expect(st.wells.filter((w) => w.status === 'outlier').length).toBe(1);
  });
});