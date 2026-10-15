import { median, sd, quantile7 } from '../stats/descriptive';
import type { OutlierMethod } from './types';

/** Dixon Q critical values, two-sided alpha = 0.05 (Rorabacher 1991), n = 3..10. */
const DIXON_Q95: Record<number, number> = {
  3: 0.97, 4: 0.829, 5: 0.71, 6: 0.625, 7: 0.568, 8: 0.526, 9: 0.493, 10: 0.466,
};

export interface OutlierDecision {
  /** indices (into the input array) to exclude */
  exclude: number[];
  reasons: Record<number, string>;
}

/**
 * Detect technical outliers among replicate Ct values.
 * Removes at most `maxOutliers` values and always keeps at least two.
 */
export function detectOutliers(
  cts: number[],
  method: OutlierMethod,
  threshold: number,
  maxOutliers: number,
): OutlierDecision {
  const exclude: number[] = [];
  const reasons: Record<number, string> = {};
  if (method === 'none' || cts.length < 3) return { exclude, reasons };

  const remaining = () => cts.map((v, i) => [v, i] as const).filter(([, i]) => !exclude.includes(i));

  if (method === 'iqr') {
    const vals = cts;
    const q1 = quantile7(vals, 0.25);
    const q3 = quantile7(vals, 0.75);
    const iqr = q3 - q1;
    const lo = q1 - 1.5 * iqr;
    const hi = q3 + 1.5 * iqr;
    const md = median(vals);
    const out = cts
      .map((v, i) => [v, i] as const)
      .filter(([v]) => v < lo || v > hi)
      .sort((a, b) => Math.abs(b[0] - md) - Math.abs(a[0] - md))
      .slice(0, Math.min(maxOutliers, cts.length - 2));
    for (const [v, i] of out) {
      exclude.push(i);
      reasons[i] = `outside Tukey fences [${lo.toFixed(2)}, ${hi.toFixed(2)}] (Ct ${v.toFixed(2)})`;
    }
    return { exclude, reasons };
  }

  for (let iter = 0; iter < maxOutliers; iter++) {
    const rem = remaining();
    if (rem.length < 3) break;
    const vals = rem.map(([v]) => v);
    const md = median(vals);
    // candidate = value furthest from the median
    let cand = rem[0];
    for (const r of rem) if (Math.abs(r[0] - md) > Math.abs(cand[0] - md)) cand = r;
    const dev = Math.abs(cand[0] - md);

    let isOutlier = false;
    let reason = '';
    if (method === 'median') {
      isOutlier = dev > threshold;
      reason = `${dev.toFixed(2)} cycles from replicate median (> ${threshold})`;
    } else if (method === 'sd') {
      const s = sd(vals);
      isOutlier = s > threshold;
      reason = `replicate SD ${s.toFixed(2)} > ${threshold}; furthest from median`;
    } else if (method === 'dixon') {
      const crit = DIXON_Q95[vals.length];
      if (crit !== undefined) {
        const sorted = [...vals].sort((a, b) => a - b);
        const range = sorted[sorted.length - 1] - sorted[0];
        if (range > 0) {
          const isLow = cand[0] === sorted[0];
          const gap = isLow ? sorted[1] - sorted[0] : sorted[sorted.length - 1] - sorted[sorted.length - 2];
          const q = gap / range;
          isOutlier = q > crit;
          reason = `Dixon Q = ${q.toFixed(3)} > ${crit} (n = ${vals.length}, alpha = 0.05)`;
        }
      }
    }
    if (!isOutlier) break;
    exclude.push(cand[1]);
    reasons[cand[1]] = reason;
  }
  return { exclude, reasons };
}