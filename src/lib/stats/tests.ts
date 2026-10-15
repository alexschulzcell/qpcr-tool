import { mean, variance, median } from './descriptive';
import { ptTwoSided, qt, pfUpper, ptukey, qtukey, pdunnett, qdunnett } from './distributions';

export interface TTestResult {
  method: 'welch' | 'student' | 'paired';
  /** mean(x) - mean(y); for paired tests the mean of the differences x - y */
  estimate: number;
  statistic: number;
  df: number;
  p: number;
  ciLow: number;
  ciHigh: number;
  n1: number;
  n2: number;
}

/** Two-sample t-test (Welch by default), two-sided. Matches R t.test(x, y). */
export function tTest(x: number[], y: number[], varEqual = false, conf = 0.95): TTestResult {
  const n1 = x.length;
  const n2 = y.length;
  const v1 = variance(x);
  const v2 = variance(y);
  let se: number;
  let df: number;
  if (varEqual) {
    df = n1 + n2 - 2;
    const vp = ((n1 - 1) * v1 + (n2 - 1) * v2) / df;
    se = Math.sqrt(vp * (1 / n1 + 1 / n2));
  } else {
    const a = v1 / n1;
    const b = v2 / n2;
    se = Math.sqrt(a + b);
    df = (a + b) ** 2 / (a ** 2 / (n1 - 1) + b ** 2 / (n2 - 1));
  }
  const est = mean(x) - mean(y);
  const t = est / se;
  const q = qt(1 - (1 - conf) / 2, df);
  return {
    method: varEqual ? 'student' : 'welch',
    estimate: est,
    statistic: t,
    df,
    p: ptTwoSided(t, df),
    ciLow: est - q * se,
    ciHigh: est + q * se,
    n1,
    n2,
  };
}

/** Paired t-test on matched pairs x[i] - y[i]. Matches R t.test(x, y, paired = TRUE). */
export function pairedTTest(x: number[], y: number[], conf = 0.95): TTestResult {
  const d = x.map((v, i) => v - y[i]);
  const n = d.length;
  const est = mean(d);
  const se = Math.sqrt(variance(d) / n);
  const df = n - 1;
  const t = est / se;
  const q = qt(1 - (1 - conf) / 2, df);
  return {
    method: 'paired',
    estimate: est,
    statistic: t,
    df,
    p: ptTwoSided(t, df),
    ciLow: est - q * se,
    ciHigh: est + q * se,
    n1: n,
    n2: n,
  };
}

export interface AnovaResult {
  method: 'anova' | 'welch-anova' | 'brown-forsythe';
  statistic: number;
  df1: number;
  df2: number;
  p: number;
  /** Pooled within-group mean square (classical ANOVA only). */
  mse?: number;
}

/** Classical one-way ANOVA. Matches R oneway.test(y ~ g, var.equal = TRUE). */
export function oneWayAnova(groups: number[][]): AnovaResult {
  const k = groups.length;
  const N = groups.reduce((s, g) => s + g.length, 0);
  const grand = mean(groups.flat());
  let ssb = 0;
  let ssw = 0;
  for (const g of groups) {
    const m = mean(g);
    ssb += g.length * (m - grand) ** 2;
    for (const v of g) ssw += (v - m) ** 2;
  }
  const df1 = k - 1;
  const df2 = N - k;
  const mse = ssw / df2;
  const F = ssb / df1 / mse;
  return { method: 'anova', statistic: F, df1, df2, p: pfUpper(F, df1, df2), mse };
}

/** Welch one-way ANOVA. Matches R oneway.test(y ~ g, var.equal = FALSE). */
export function welchAnova(groups: number[][]): AnovaResult {
  const k = groups.length;
  const n = groups.map((g) => g.length);
  const m = groups.map(mean);
  const v = groups.map(variance);
  const w = n.map((ni, i) => ni / v[i]);
  const W = w.reduce((a, b) => a + b, 0);
  const mw = w.reduce((s, wi, i) => s + wi * m[i], 0) / W;
  const A = w.reduce((s, wi, i) => s + wi * (m[i] - mw) ** 2, 0) / (k - 1);
  const tmp = w.reduce((s, wi, i) => s + (1 - wi / W) ** 2 / (n[i] - 1), 0) / (k * k - 1);
  const F = A / (1 + 2 * (k - 2) * tmp);
  const df1 = k - 1;
  const df2 = 1 / (3 * tmp);
  return { method: 'welch-anova', statistic: F, df1, df2, p: pfUpper(F, df1, df2) };
}

/** Brown-Forsythe (median-centred Levene) test. Matches car::leveneTest(center = median). */
export function brownForsythe(groups: number[][]): AnovaResult {
  const dev = groups.map((g) => {
    const md = median(g);
    return g.map((v) => Math.abs(v - md));
  });
  return { ...oneWayAnova(dev), method: 'brown-forsythe' };
}

export interface PairwiseResult {
  /** index of the first group (for Dunnett: the control) */
  i: number;
  /** index of the second group */
  j: number;
  /** mean(group j) - mean(group i), as in R TukeyHSD */
  estimate: number;
  statistic: number;
  df: number;
  ciLow: number;
  ciHigh: number;
  pAdj: number;
}

/** Tukey HSD (Tukey-Kramer for unequal n). Matches R TukeyHSD(aov(y ~ g)). */
export function tukeyHSD(groups: number[][], conf = 0.95): PairwiseResult[] {
  const k = groups.length;
  const { mse, df2 } = oneWayAnova(groups);
  const m = groups.map(mean);
  const n = groups.map((g) => g.length);
  const qcrit = qtukey(conf, k, df2);
  const out: PairwiseResult[] = [];
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      const est = m[j] - m[i];
      const se = Math.sqrt((mse! / 2) * (1 / n[i] + 1 / n[j]));
      const q = Math.abs(est) / se;
      out.push({
        i,
        j,
        estimate: est,
        statistic: q,
        df: df2,
        ciLow: est - qcrit * se,
        ciHigh: est + qcrit * se,
        pAdj: 1 - ptukey(q, k, df2),
      });
    }
  }
  return out;
}

/** Games-Howell post-hoc test. Matches rstatix::games_howell_test. */
export function gamesHowell(groups: number[][], conf = 0.95): PairwiseResult[] {
  const k = groups.length;
  const m = groups.map(mean);
  const n = groups.map((g) => g.length);
  const v = groups.map(variance);
  const out: PairwiseResult[] = [];
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      const est = m[j] - m[i];
      const a = v[i] / n[i];
      const b = v[j] / n[j];
      const se = Math.sqrt(a + b);
      const df = (a + b) ** 2 / (a ** 2 / (n[i] - 1) + b ** 2 / (n[j] - 1));
      const t = Math.abs(est) / se;
      const qcrit = qtukey(conf, k, df) / Math.SQRT2;
      out.push({
        i,
        j,
        estimate: est,
        statistic: t,
        df,
        ciLow: est - qcrit * se,
        ciHigh: est + qcrit * se,
        pAdj: 1 - ptukey(t * Math.SQRT2, k, df),
      });
    }
  }
  return out;
}

/**
 * Dunnett many-to-one comparisons against group `control` (two-sided, pooled variance).
 * Matches multcomp::glht(aov(y ~ g), linfct = mcp(g = "Dunnett")).
 * Rows have i = control, j = treatment, estimate = mean(j) - mean(control).
 */
export function dunnett(groups: number[][], control: number, conf = 0.95): PairwiseResult[] {
  const { mse, df2 } = oneWayAnova(groups);
  const m = groups.map(mean);
  const n = groups.map((g) => g.length);
  const others = groups.map((_, idx) => idx).filter((idx) => idx !== control);
  const lambdas = others.map((j) => Math.sqrt(n[j] / (n[j] + n[control])));
  const ccrit = qdunnett(conf, lambdas, df2);
  return others.map((j) => {
    const est = m[j] - m[control];
    const se = Math.sqrt(mse! * (1 / n[j] + 1 / n[control]));
    const t = est / se;
    return {
      i: control,
      j,
      estimate: est,
      statistic: t,
      df: df2,
      ciLow: est - ccrit * se,
      ciHigh: est + ccrit * se,
      pAdj: Math.max(0, 1 - pdunnett(Math.abs(t), lambdas, df2)),
    };
  });
}

export type PAdjustMethod = 'none' | 'holm' | 'bonferroni' | 'BH';

/** Multiple-testing correction. Matches R p.adjust. */
export function pAdjust(p: number[], method: PAdjustMethod): number[] {
  const n = p.length;
  if (method === 'none' || n <= 1) return [...p];
  if (method === 'bonferroni') return p.map((v) => Math.min(1, v * n));
  const order = p.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(n);
  if (method === 'holm') {
    let cummax = 0;
    order.forEach(([v, idx], rank) => {
      cummax = Math.max(cummax, Math.min(1, (n - rank) * v));
      out[idx] = cummax;
    });
    return out;
  }
  // Benjamini-Hochberg
  let cummin = 1;
  for (let r = n - 1; r >= 0; r--) {
    const [v, idx] = order[r];
    cummin = Math.min(cummin, (n * v) / (r + 1));
    out[idx] = Math.min(1, cummin);
  }
  return out;
}