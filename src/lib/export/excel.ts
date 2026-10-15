import * as XLSX from 'xlsx';
import type { Design } from '../analysis/design';
import { panelLabel } from '../analysis/design';
import type { AnalysisResult, Settings } from '../analysis/types';
import { pointValue, SCALE_SHORT } from '../analysis/scale';
import type { ParsedFile } from '../parse/quantstudio';
import { stars } from '../format';
import { generateMethods } from './methods';

const r = (x: number | null | undefined, d = 6) =>
  x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d;

/** Build the full results workbook. */
export function buildWorkbook(
  files: ParsedFile[],
  design: Design,
  s: Settings,
  res: AnalysisResult,
  version: string,
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const hasPanels = res.panels.length > 1;
  const P = (p: string) => panelLabel(p, hasPanels);
  const ebar = s.errorBar.toUpperCase();

  const summary = res.summaries.map((g) => ({
    Target: g.target,
    Panel: P(g.panel),
    Group: g.group,
    Reference: g.isReference ? 'yes' : '',
    n: g.n,
    'Mean dCt': r(g.meanDct),
    'SD dCt': r(g.sdDct),
    'Mean ddCt': r(g.meanDdct),
    'RQ (geometric mean)': r(g.rq),
    [`RQ - ${ebar}`]: r(g.rqLow),
    [`RQ + ${ebar}`]: r(g.rqHigh),
    log2FC: r(g.log2fc),
    [`${ebar} (log2 scale)`]: r(g.err),
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Summary');

  const stats = res.stats.flatMap((st) => {
    const base = {
      Target: st.target,
      Panel: P(st.panel),
      Test: st.testName,
      'Omnibus test': st.omnibus?.method ?? '',
      'Omnibus F': r(st.omnibus?.statistic, 4),
      'Omnibus df': st.omnibus ? `${r(st.omnibus.df1, 0)}, ${r(st.omnibus.df2, 3)}` : '',
      'Omnibus p': r(st.omnibus?.p, 8),
    };
    if (st.comparisons.length === 0) return [{ ...base, Notes: st.notes.join(' ') }];
    return st.comparisons.map((c) => ({
      ...base,
      'Group 1 (reference)': c.group1,
      'Group 2': c.group2,
      'ddCt (2 vs 1)': r(c.diffDct),
      'Fold change (2 vs 1)': r(c.foldChange),
      'FC 95% CI low': r(c.fcLow),
      'FC 95% CI high': r(c.fcHigh),
      Statistic: r(c.statistic, 4),
      df: r(c.df, 3),
      Method: c.method,
      'p (adjusted within gene)': r(c.pAdj, 8),
      'p (final)': r(c.pFinal, 8),
      Significance: stars(c.pFinal, s.alpha),
      Notes: st.notes.join(' '),
    }));
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(stats), 'Statistics');

  const bio = res.bioreps.map((b) => ({
    Target: b.target,
    Sample: b.sample,
    Panel: P(b.panel),
    Group: b.group,
    'Bio rep': b.biorep,
    'Mean Ct target': r(b.ctTarget, 4),
    'Mean Ct reference gene(s)': r(b.ctHK, 4),
    dCt: r(b.dCt),
    ddCt: r(b.ddCt),
    RQ: r(b.rq),
    log2FC: r(b.log2fc),
    '2^-dCt': r(b.relExpr, 8),
    'Used in statistics': b.valid ? 'yes' : 'no',
    Flags: b.flags.join('; '),
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(bio), 'Biological replicates');

  const maxRep = Math.max(1, ...res.sampleTargets.map((x) => x.nTotal));
  const tech = res.sampleTargets.map((x) => {
    const row: Record<string, unknown> = {
      Sample: x.sample,
      Target: x.target,
      Wells: x.nTotal,
      Detected: x.nDetected,
      Used: x.nUsed,
      'Mean Ct': r(x.meanCt, 4),
      'SD Ct': r(x.sdCt, 4),
      'Sample detected': x.detected ? 'yes' : 'no',
      'High SD': x.highSd ? 'yes' : '',
      'Low confidence': x.lowConfidence ? 'yes' : '',
    };
    for (let i = 0; i < maxRep; i++) {
      const w = x.wells[i];
      row[`Ct ${i + 1}`] = w ? (w.well.ct ?? w.well.ctRaw) : null;
      row[`Status ${i + 1}`] = w ? w.status : null;
    }
    return row;
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(tech), 'Technical replicates');

  const wells = res.sampleTargets.flatMap((x) =>
    x.wells.map((w) => ({
      File: w.well.fileName,
      Well: w.well.position,
      Sample: w.well.sample,
      Target: w.well.target,
      'Ct (raw)': w.well.ctRaw,
      Ct: w.well.ct,
      Status: w.status,
      Reason: w.reason,
      'Instrument flags': w.well.flags.join(' '),
      'Omit (instrument)': w.well.omit ? 'true' : '',
    })),
  );
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(wells), 'Wells');

  // Prism-style tables: groups as columns, one block per panel
  for (const target of s.targetGenes) {
    const aoa: (string | number | null)[][] = [];
    for (const p of res.panels) {
      const groups = res.groupsByPanel[p];
      const cols = groups.map((g) =>
        res.bioreps
          .filter((b) => b.target === target && b.panel === p && b.group === g && b.valid)
          .map((b) => r(pointValue(b, s.outputScale))),
      );
      const n = Math.max(0, ...cols.map((c) => c.length));
      if (n === 0) continue;
      aoa.push([`${target}${hasPanels ? ` - ${P(p)}` : ''} (${SCALE_SHORT[s.outputScale]})`]);
      aoa.push(groups);
      for (let i = 0; i < n; i++) aoa.push(cols.map((c) => c[i] ?? null));
      aoa.push([]);
    }
    if (aoa.length) {
      const name = `Prism ${target}`.replace(/[\\/?*[\]:]/g, '_').slice(0, 31);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
    }
  }

  const hk = res.hkStability.flatMap((h) =>
    h.groups.map((g) => ({
      'Reference gene': h.gene,
      Panel: P(h.panel),
      Group: g.group,
      n: g.n,
      'Mean Ct': r(g.meanCt, 4),
      'SD Ct': r(g.sdCt, 4),
      'Range of group means': r(h.range, 3),
      'p (Welch)': r(h.p, 6),
      Warning: h.warn ? 'reference gene differs between groups' : '',
    })),
  );
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hk), 'Reference gene QC');

  const settingsRows: [string, string | number][] = [
    ['qPCR Tool version', version],
    ['Analysis date', new Date().toISOString().slice(0, 10)],
    ['Input files', files.map((f) => f.name).join('; ')],
    ['Reference genes', s.hkGenes.join(', ')],
    ['Target genes', s.targetGenes.join(', ')],
    ['Efficiencies (%)', Object.entries(s.efficiencies).map(([g, e]) => `${g}: ${e}`).join(', ') || 'all 100 %'],
    ['Ct cutoff (not detected above)', s.ctCutoff],
    ['Low-confidence Ct', s.lowConfidenceCt],
    ['Min. detected technical replicates', s.minDetected],
    ['Not detected samples', s.ndSampleMode],
    ['Respect instrument Omit flag', String(s.respectOmit)],
    ['Technical outlier method', s.outlierMethod],
    ['Outlier threshold (cycles)', s.outlierThreshold],
    ['Max. outliers per sample', s.maxOutliers],
    ['Manually excluded wells', s.manualExcluded.join(', ')],
    ['Reference group', s.referenceGroup],
    ['Reference scope', s.referenceScope],
    ['Output scale', s.outputScale],
    ['Error bars', s.errorBar],
    ['Test family', s.testFamily],
    ['Comparisons', s.comparisons],
    ['Alpha', s.alpha],
    ['Correction across genes', s.multiGeneCorrection],
  ];
  const designRows = design.conditions.map((c) => [`Condition ${c.name}`, `panel: ${P(c.panel)}, group: ${c.group}, included: ${c.include}`] as [string, string]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Setting', 'Value'], ...settingsRows, ...designRows]), 'Settings');

  const m = generateMethods(files, s, res, version);
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([['Methods (draft)'], [m.text], [], ['References'], ...m.references.map((x) => [x]), [], ['Software'], [m.citation]]),
    'Methods',
  );
  return wb;
}

export function downloadWorkbook(wb: XLSX.WorkBook, fileName: string) {
  XLSX.writeFile(wb, fileName, { compression: true });
}