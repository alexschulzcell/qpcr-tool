import { mean } from '../stats/descriptive';
import {
  brownForsythe,
  dunnett,
  gamesHowell,
  oneWayAnova,
  pAdjust,
  pairedTTest,
  tTest,
  tukeyHSD,
  welchAnova,
  type PairwiseResult,
  type TTestResult,
} from '../stats/tests';
import type { BioRepResult, Comparison, PanelStats, Settings, TestFamily } from './types';

interface GroupData {
  group: string;
  values: BioRepResult[];
}

export const TEST_LABELS: Record<Exclude<TestFamily, 'auto'>, { two: string; allPairs: string; vsReference: string }> = {
  welch: {
    two: "Welch's t-test",
    allPairs: "Welch's ANOVA + Games-Howell post-hoc test",
    vsReference: "Welch's ANOVA + Welch's t-tests vs. reference (Holm-adjusted)",
  },
  classic: {
    two: "Student's t-test",
    allPairs: 'One-way ANOVA + Tukey HSD',
    vsReference: "One-way ANOVA + Dunnett's test vs. reference",
  },
  paired: {
    two: 'Paired t-test',
    allPairs: 'Paired t-tests, all pairs (Holm-adjusted)',
    vsReference: 'Paired t-tests vs. reference (Holm-adjusted)',
  },
};

export function resolveFamily(f: TestFamily): Exclude<TestFamily, 'auto'> {
  return f === 'auto' ? 'welch' : f;
}

function fromT(g1: string, g2: string, r: TTestResult, method: string): Comparison {
  // r.estimate = mean(g2) - mean(g1) on the dCt scale
  return {
    group1: g1,
    group2: g2,
    diffDct: r.estimate,
    foldChange: Math.pow(2, -r.estimate),
    fcLow: Math.pow(2, -r.ciHigh),
    fcHigh: Math.pow(2, -r.ciLow),
    statistic: r.statistic,
    df: r.df,
    p: r.p,
    pAdj: r.p,
    pFinal: r.p,
    method,
  };
}

function fromPairwise(names: string[], r: PairwiseResult, method: string): Comparison {
  return {
    group1: names[r.i],
    group2: names[r.j],
    diffDct: r.estimate,
    foldChange: Math.pow(2, -r.estimate),
    fcLow: Math.pow(2, -r.ciHigh),
    fcHigh: Math.pow(2, -r.ciLow),
    statistic: r.statistic,
    df: r.df,
    p: r.pAdj,
    pAdj: r.pAdj,
    pFinal: r.pAdj,
    method,
  };
}

/** Pair values of two groups by biological replicate id. */
function pairUp(a: BioRepResult[], b: BioRepResult[]) {
  const x: number[] = [];
  const y: number[] = [];
  for (const va of a) {
    const vb = b.find((v) => v.biorep === va.biorep);
    if (vb) {
      x.push(va.dCt!);
      y.push(vb.dCt!);
    }
  }
  return { x, y, dropped: a.length + b.length - 2 * x.length };
}

export function runPanelStats(target: string, panel: string, all: GroupData[], s: Settings): PanelStats | null {
  const notes: string[] = [];
  const groups = all.filter((g) => g.values.length > 0);
  const tooSmall = groups.filter((g) => g.values.length < 2);
  const usable = groups.filter((g) => g.values.length >= 2);
  for (const g of tooSmall) notes.push(`Group "${g.group}" has n = ${g.values.length}; excluded from statistics (n >= 2 required).`);
  if (usable.length < 2) {
    if (groups.length >= 2) notes.push('Fewer than two groups with n >= 2: no statistical test possible.');
    return groups.length
      ? {
          target,
          panel,
          groups: groups.map((g) => g.group),
          n: groups.map((g) => g.values.length),
          family: resolveFamily(s.testFamily),
          comparisons: [],
          testName: 'none',
          notes,
        }
      : null;
  }

  const family = resolveFamily(s.testFamily);
  const names = usable.map((g) => g.group);
  const data = usable.map((g) => g.values.map((v) => v.dCt!));
  const n = data.map((d) => d.length);
  const k = usable.length;
  const refIdx = names.indexOf(s.referenceGroup);
  let mode = s.comparisons;
  if (mode === 'vsReference' && refIdx < 0) {
    notes.push(`Reference group "${s.referenceGroup}" not available in this panel; all pairwise comparisons shown.`);
    mode = 'allPairs';
  }

  if (data.some((d) => d.every((v) => v === d[0]))) {
    notes.push('A group has zero variance (identical values); test results may be undefined.');
  }
  if (Math.min(...n) < 3) notes.push('n < 3 in at least one group: very low statistical power; interpret with caution.');

  let variance: PanelStats['variance'];
  const bf = brownForsythe(data);
  if (Number.isFinite(bf.p)) {
    variance = { method: 'Brown-Forsythe', statistic: bf.statistic, p: bf.p };
    if (bf.p < 0.05 && family === 'classic') {
      notes.push(
        `Brown-Forsythe test suggests unequal variances (p = ${bf.p.toPrecision(2)}); Welch-type tests are recommended.`,
      );
    }
  }

  const comparisons: Comparison[] = [];
  let omnibus: PanelStats['omnibus'];
  const labels = TEST_LABELS[family];
  const testName = k === 2 ? labels.two : mode === 'allPairs' ? labels.allPairs : labels.vsReference;

  if (k === 2) {
    const g1 = refIdx >= 0 ? refIdx : 0;
    const g2 = 1 - g1;
    if (family === 'paired') {
      const { x, y, dropped } = pairUp(usable[g2].values, usable[g1].values);
      if (dropped) notes.push(`${dropped} unpaired sample(s) dropped for the paired test.`);
      if (x.length >= 2) comparisons.push(fromT(names[g1], names[g2], pairedTTest(x, y), labels.two));
    } else {
      comparisons.push(fromT(names[g1], names[g2], tTest(data[g2], data[g1], family === 'classic'), labels.two));
    }
  } else {
    if (family === 'welch') {
      const w = welchAnova(data);
      omnibus = { method: "Welch's ANOVA", statistic: w.statistic, df1: w.df1, df2: w.df2, p: w.p };
    } else if (family === 'classic') {
      const a = oneWayAnova(data);
      omnibus = { method: 'One-way ANOVA', statistic: a.statistic, df1: a.df1, df2: a.df2, p: a.p };
    } else {
      notes.push('Paired design with > 2 groups: pairwise paired t-tests with Holm correction (no omnibus test).');
    }

    if (family === 'classic' && mode === 'allPairs') {
      for (const r of tukeyHSD(data)) comparisons.push(fromPairwise(names, r, 'Tukey HSD'));
    } else if (family === 'classic') {
      for (const r of dunnett(data, refIdx)) comparisons.push(fromPairwise(names, r, "Dunnett's test"));
    } else if (family === 'welch' && mode === 'allPairs') {
      for (const r of gamesHowell(data)) comparisons.push(fromPairwise(names, r, 'Games-Howell'));
    } else {
      // Welch or paired t-tests (vs reference or all pairs), Holm-adjusted
      const pairs: [number, number][] = [];
      if (mode === 'vsReference') {
        for (let j = 0; j < k; j++) if (j !== refIdx) pairs.push([refIdx, j]);
      } else {
        for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) pairs.push([i, j]);
      }
      const method = family === 'paired' ? 'paired t-test (Holm)' : "Welch's t-test (Holm)";
      const raw: Comparison[] = [];
      for (const [i, j] of pairs) {
        if (family === 'paired') {
          const { x, y } = pairUp(usable[j].values, usable[i].values);
          if (x.length >= 2) raw.push(fromT(names[i], names[j], pairedTTest(x, y), method));
        } else {
          raw.push(fromT(names[i], names[j], tTest(data[j], data[i], false), method));
        }
      }
      const adj = pAdjust(raw.map((c) => c.p), 'holm');
      raw.forEach((c, idx) => {
        c.pAdj = adj[idx];
        c.pFinal = adj[idx];
      });
      comparisons.push(...raw);
    }
  }

  return {
    target,
    panel,
    groups: names,
    n,
    family,
    omnibus,
    variance,
    comparisons,
    testName,
    notes,
  };
}

export interface Recommendation {
  family: Exclude<TestFamily, 'auto'>;
  title: string;
  reasons: string[];
}

/** Explain which test is recommended for the current design. */
export function recommend(groupSizes: number[][], pairable: boolean, comparisons: Settings['comparisons']): Recommendation {
  const reasons: string[] = [];
  const maxK = Math.max(0, ...groupSizes.map((g) => g.length));
  const minN = Math.min(Infinity, ...groupSizes.flat());
  reasons.push(
    'Tests are performed on delta Ct values (log2 scale), which are approximately normally distributed; fold changes (RQ) are not.',
  );
  if (pairable) {
    reasons.push(
      'Replicate numbers match across groups. If replicates with the same number share a donor, passage or experiment day, choose the paired design: it removes between-experiment variation.',
    );
  }
  reasons.push(
    "Welch's tests do not assume equal variances and lose virtually no power when variances are equal (Delacre et al. 2017, 2019); they are the safe default.",
  );
  if (maxK > 2) {
    reasons.push(
      comparisons === 'vsReference'
        ? 'More than two groups compared to one reference: post-hoc tests vs. the reference are corrected for multiple comparisons (Holm for Welch, Dunnett for classical ANOVA).'
        : 'More than two groups, all pairwise comparisons: Games-Howell (Welch) or Tukey HSD (classical) control the family-wise error rate.',
    );
  }
  if (minN <= 3) {
    reasons.push(
      'With n = 3 per group, normality cannot be tested meaningfully, and rank-based tests (Mann-Whitney) cannot reach p < 0.05 (minimum two-sided p = 0.1 for 3 vs. 3). Parametric tests on delta Ct are standard.',
    );
  }
  const avg = groupSizes.flat();
  if (avg.length && mean(avg) < 3) reasons.push('Some groups have fewer than 3 biological replicates.');
  return {
    family: 'welch',
    title: maxK > 2 ? TEST_LABELS.welch[comparisons] : TEST_LABELS.welch.two,
    reasons,
  };
}