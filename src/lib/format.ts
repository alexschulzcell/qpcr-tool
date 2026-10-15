export function fmtP(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return 'n/a';
  if (p < 0.0001) return '< 0.0001';
  if (p < 0.001) return p.toFixed(4);
  return p.toFixed(p < 0.01 ? 4 : 3);
}

/** GraphPad-style significance stars. */
export function stars(p: number | null | undefined, alpha = 0.05): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return '';
  if (p >= alpha) return 'ns';
  if (p < 0.0001) return '****';
  if (p < 0.001) return '***';
  if (p < 0.01) return '**';
  return '*';
}

export function fmt(x: number | null | undefined, digits = 3): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '';
  return x.toFixed(digits);
}

/** Significant-digit formatting for fold changes. */
export function fmtFC(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '';
  if (Math.abs(x) >= 100) return x.toFixed(0);
  if (Math.abs(x) >= 10) return x.toFixed(1);
  if (Math.abs(x) >= 0.01) return x.toFixed(3);
  return x.toPrecision(3);
}

export function sanitizeFileName(s: string): string {
  return s.replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '_').slice(0, 80) || 'qpcr';
}