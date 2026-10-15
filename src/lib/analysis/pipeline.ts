import type { Well } from '../parse/quantstudio';
import { mean, sd, variance } from '../stats/descriptive';
import { qt } from '../stats/distributions';
import { pAdjust, tTest, welchAnova } from '../stats/tests';
import type { Design } from './design';
import { detectOutliers } from './outliers';
import { runPanelStats } from './statsRunner';
import type {
  AnalysisResult,
  BioRepResult,
  GroupSummary,
  HKStability,
  PanelStats,
  SampleTargetResult,
  Settings,
  WellResult,
} from './types';

/** log2 of the amplification factor E = 1 + efficiency/100 (1 for 100 % efficiency). */
export function log2E(settings: Settings, gene: string): number {
  const eff = settings.efficiencies[gene];
  if (eff === undefined || !Number.isFinite(eff) || eff <= 0) return 1;
  return Math.log2(1 + eff / 100);
}

/** Process the technical replicates of one sample x target. */
export function processReplicates(sample: string, target: string, wells: Well[], s: Settings): SampleTargetResult {
  const results: WellResult[] = [];
  const candidates: { idx: number; ct: number }[] = [];
  const manual = new Set(s.manualExcluded);

  wells.forEach((w) => {
    if (manual.has(w.id)) {
      results.push({ well: w, status: 'manual', reason: 'excluded manually' });
    } else if (s.respectOmit && w.omit) {
      results.push({ well: w, status: 'omitted', reason: 'omitted in instrument software' });
    } else if (w.ct === null) {
      results.push({ well: w, status: 'nd', reason: w.undetermined ? 'undetermined' : 'no Ct value' });
    } else if (w.ct > s.ctCutoff) {
      results.push({ well: w, status: 'nd', reason: `Ct ${w.ct.toFixed(2)} > cutoff ${s.ctCutoff}` });
    } else {
      candidates.push({ idx: results.length, ct: w.ct });
      results.push({ well: w, status: 'used', reason: '' });
    }
  });

  const nDetected = candidates.length;
  const nConsidered = results.filter((r) => r.status !== 'manual' && r.status !== 'omitted').length;
  const detected = nDetected >= Math.max(1, Math.min(s.minDetected, nConsidered));

  if (detected) {
    const dec = detectOutliers(
      candidates.map((c) => c.ct),
      s.outlierMethod,
      s.outlierThreshold,
      s.maxOutliers,
    );
    for (const i of dec.exclude) {
      const r = results[candidates[i].idx];
      r.status = 'outlier';
      r.reason = `technical outlier: ${dec.reasons[i]}`;
    }
  } else {
    for (const c of candidates) {
      const r = results[c.idx];
      r.status = 'nd-sample';
      r.reason = `only ${nDetected} of ${wells.length} replicates detected (minimum ${s.minDetected})`;
    }
  }

  const used = results.filter((r) => r.status === 'used').map((r) => r.well.ct as number);
  const meanCt = used.length ? mean(used) : null;
  const sdCt = used.length >= 2 ? sd(used) : null;
  return {
    sample,
    target,
    wells: results,
    nTotal: wells.length,
    nConsidered,
    nDetected,
    nUsed: used.length,
    meanCt,
    sdCt,
    detected,
    imputed: false,
    lowConfidence: meanCt !== null && meanCt > s.lowConfidenceCt,
    highSd: sdCt !== null && sdCt > s.highSdWarn,
  };
}

const SEP = '\u0000';

export function runAnalysis(wells: Well[], design: Design, s: Settings): AnalysisResult {
  const warnings: string[] = [];
  const condMap = new Map(design.conditions.map((c) => [c.name, c]));
  const included = design.samples.filter((x) => x.include && condMap.get(x.condition)?.include);
  const genes = [...new Set([...s.hkGenes, ...s.targetGenes])];

  if (s.hkGenes.length === 0) warnings.push('Select at least one housekeeping (reference) gene.');
  if (s.targetGenes.length === 0) warnings.push('Select at least one target gene.');

  // Group wells by sample + target
  const byKey = new Map<string, Well[]>();
  for (const w of wells) {
    if (w.task === 'NTC' || w.task === 'STANDARD') continue;
    const k = w.sample + SEP + w.target;
    const arr = byKey.get(k);
    if (arr) arr.push(w);
    else byKey.set(k, [w]);
  }

  const sampleTargets: SampleTargetResult[] = [];
  const st = new Map<string, SampleTargetResult>();
  for (const smp of included) {
    for (const g of genes) {
      const ws = byKey.get(smp.sample + SEP + g);
      if (!ws) continue;
      const r = processReplicates(smp.sample, g, ws, s);
      sampleTargets.push(r);
      st.set(smp.sample + SEP + g, r);
    }
  }

  // Biological replicate level
  const bioreps: BioRepResult[] = [];
  for (const target of s.targetGenes) {
    for (const smp of included) {
      const cond = condMap.get(smp.condition)!;
      const tr = st.get(smp.sample + SEP + target);
      if (!tr) continue;
      const flags: string[] = [];
      const hk = s.hkGenes.map((h) => st.get(smp.sample + SEP + h));
      const hkOk = hk.length > 0 && hk.every((h) => h && h.detected && h.meanCt !== null);
      if (!hkOk) flags.push('reference gene not detected');
      const ctHK = hkOk ? mean(hk.map((h) => h!.meanCt!)) : null;
      const wHK = hkOk ? mean(s.hkGenes.map((h, i) => hk[i]!.meanCt! * log2E(s, h))) : null;

      let ctTarget = tr.meanCt;
      let imputed = false;
      const missing = tr.nConsidered === 0;
      const notDetected = !tr.detected && !missing;
      if (missing) {
        ctTarget = null;
        flags.push('all replicates excluded');
      } else if (notDetected) {
        if (s.ndSampleMode === 'impute') {
          ctTarget = s.ctCutoff;
          imputed = true;
          flags.push(`not detected, Ct set to cutoff (${s.ctCutoff})`);
        } else {
          ctTarget = null;
          flags.push('not detected');
        }
      }
      if (tr.lowConfidence) flags.push(`low expression (Ct > ${s.lowConfidenceCt})`);
      if (tr.highSd) flags.push(`replicate SD > ${s.highSdWarn}`);
      for (const h of hk) if (h?.highSd) flags.push(`${h.target} replicate SD > ${s.highSdWarn}`);

      const dCt = ctTarget !== null && wHK !== null ? ctTarget * log2E(s, target) - wHK : null;
      bioreps.push({
        target,
        sample: smp.sample,
        condition: smp.condition,
        panel: cond.panel,
        group: cond.group,
        biorep: smp.biorep,
        ctTarget,
        ctHK,
        dCt,
        ddCt: null,
        rq: null,
        log2fc: null,
        relExpr: dCt !== null ? Math.pow(2, -dCt) : null,
        valid: dCt !== null,
        notDetected,
        imputed,
        flags,
      });
    }
  }

  // Panels and group order (order of appearance, reference group first)
  const panels: string[] = [];
  const groupsByPanel: Record<string, string[]> = {};
  for (const c of design.conditions) {
    if (!c.include || !included.some((x) => x.condition === c.name)) continue;
    if (!panels.includes(c.panel)) panels.push(c.panel);
    const arr = (groupsByPanel[c.panel] ??= []);
    if (!arr.includes(c.group)) arr.push(c.group);
  }
  for (const p of panels) {
    const arr = groupsByPanel[p];
    const refIdx = arr.indexOf(s.referenceGroup);
    if (refIdx > 0) arr.unshift(...arr.splice(refIdx, 1));
  }

  // Reference and ddCt
  for (const target of s.targetGenes) {
    const rows = bioreps.filter((b) => b.target === target);
    const pooledRef = rows.filter((b) => b.valid && b.group === s.referenceGroup).map((b) => b.dCt!);
    for (const p of panels) {
      const inPanel = rows.filter((b) => b.panel === p);
      let ref =
        s.referenceScope === 'pooled'
          ? pooledRef
          : inPanel.filter((b) => b.valid && b.group === s.referenceGroup).map((b) => b.dCt!);
      if (ref.length === 0 && s.referenceScope === 'panel' && pooledRef.length > 0 && inPanel.length > 0) {
        warnings.push(
          `${target}: reference group "${s.referenceGroup}" missing in panel "${p || '(no prefix)'}"; pooled reference used.`,
        );
        ref = pooledRef;
      }
      if (ref.length === 0) continue;
      const refMean = mean(ref);
      for (const b of inPanel) {
        if (b.dCt === null) continue;
        b.ddCt = b.dCt - refMean;
        b.rq = Math.pow(2, -b.ddCt);
        b.log2fc = -b.ddCt;
      }
    }
    if (s.referenceGroup && pooledRef.length === 0 && rows.length > 0) {
      warnings.push(
        `${target}: no valid samples in reference group "${s.referenceGroup}", so RQ cannot be computed. Show 2^-ΔCt instead (Output), or set not-detected samples to the Ct cutoff (Detection).`,
      );
    }
  }

  // Group summaries
  const summaries: GroupSummary[] = [];
  for (const target of s.targetGenes) {
    for (const p of panels) {
      for (const g of groupsByPanel[p]) {
        const vals = bioreps.filter((b) => b.target === target && b.panel === p && b.group === g && b.valid);
        const dcts = vals.map((v) => v.dCt!);
        const n = dcts.length;
        if (n === 0) continue;
        const meanDdct = mean(vals.map((v) => v.ddCt ?? NaN));
        const sdv = n >= 2 ? Math.sqrt(variance(dcts)) : NaN;
        const err =
          n < 2
            ? 0
            : s.errorBar === 'sd'
              ? sdv
              : s.errorBar === 'sem'
                ? sdv / Math.sqrt(n)
                : (qt(0.975, n - 1) * sdv) / Math.sqrt(n);
        summaries.push({
          target,
          panel: p,
          group: g,
          isReference: g === s.referenceGroup,
          n,
          meanDct: mean(dcts),
          sdDct: sdv,
          meanDdct,
          rq: Math.pow(2, -meanDdct),
          rqLow: Math.pow(2, -(meanDdct + err)),
          rqHigh: Math.pow(2, -(meanDdct - err)),
          log2fc: -meanDdct,
          err,
          values: vals,
        });
      }
    }
  }

  // Statistics
  const stats: PanelStats[] = [];
  for (const target of s.targetGenes) {
    for (const p of panels) {
      const groups = groupsByPanel[p].map((g) => ({
        group: g,
        values: bioreps.filter((b) => b.target === target && b.panel === p && b.group === g && b.valid),
      }));
      const ps = runPanelStats(target, p, groups, s);
      if (ps) stats.push(ps);
    }
  }
  // Correction across genes
  const all = stats.flatMap((x) => x.comparisons);
  if (s.multiGeneCorrection !== 'none' && s.targetGenes.length > 1) {
    const adj = pAdjust(
      all.map((c) => c.pAdj),
      s.multiGeneCorrection,
    );
    all.forEach((c, i) => (c.pFinal = adj[i]));
  } else {
    all.forEach((c) => (c.pFinal = c.pAdj));
  }

  // Reference gene stability across groups
  const hkStability: HKStability[] = [];
  for (const h of s.hkGenes) {
    for (const p of panels) {
      const groups = groupsByPanel[p].map((g) => {
        const cts = included
          .filter((x) => condMap.get(x.condition)!.panel === p && condMap.get(x.condition)!.group === g)
          .map((x) => st.get(x.sample + SEP + h))
          .filter((r) => r && r.detected && r.meanCt !== null)
          .map((r) => r!.meanCt!);
        return { group: g, meanCt: mean(cts), sdCt: cts.length >= 2 ? sd(cts) : NaN, n: cts.length, cts };
      });
      const usable = groups.filter((g) => g.n >= 2);
      let pval: number | null = null;
      if (usable.length === 2) pval = tTest(usable[0].cts, usable[1].cts).p;
      else if (usable.length > 2) pval = welchAnova(usable.map((g) => g.cts)).p;
      if (pval !== null && !Number.isFinite(pval)) pval = null;
      const means = groups.filter((g) => g.n > 0).map((g) => g.meanCt);
      const range = means.length ? Math.max(...means) - Math.min(...means) : 0;
      hkStability.push({
        gene: h,
        panel: p,
        groups: groups.map((g) => ({ group: g.group, meanCt: g.meanCt, sdCt: g.sdCt, n: g.n })),
        range,
        p: pval,
        warn: range > 1 || (pval !== null && pval < 0.05),
      });
    }
  }

  return { sampleTargets, bioreps, summaries, stats, hkStability, warnings, panels, groupsByPanel };
}