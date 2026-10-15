export function mean(x: number[]): number {
  if (x.length === 0) return NaN;
  let s = 0;
  for (const v of x) s += v;
  return s / x.length;
}

/** Sample variance (n - 1 denominator). */
export function variance(x: number[]): number {
  const n = x.length;
  if (n < 2) return NaN;
  const m = mean(x);
  let s = 0;
  for (const v of x) s += (v - m) * (v - m);
  return s / (n - 1);
}

export function sd(x: number[]): number {
  return Math.sqrt(variance(x));
}

export function sem(x: number[]): number {
  return sd(x) / Math.sqrt(x.length);
}

export function median(x: number[]): number {
  if (x.length === 0) return NaN;
  const s = [...x].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : 0.5 * (s[mid - 1] + s[mid]);
}

/** Quantile, R type 7 (default of quantile()). */
export function quantile7(x: number[], p: number): number {
  const s = [...x].sort((a, b) => a - b);
  const h = (s.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return s[lo] + (h - lo) * (s[hi] - s[lo]);
}