import type { BioRepResult, GroupSummary, OutputScale } from './types';

export const SCALE_LABEL: Record<OutputScale, string> = {
  rq: 'Relative expression (RQ)',
  log2fc: 'log2 fold change',
  relexpr: 'Expression rel. to reference gene (2^-ΔCt)',
  dct: 'ΔCt',
};

export const SCALE_SHORT: Record<OutputScale, string> = {
  rq: 'RQ',
  log2fc: 'log2FC',
  relexpr: '2^-dCt',
  dct: 'dCt',
};

/** Value of a biological replicate on the chosen output scale. */
export function pointValue(b: BioRepResult, scale: OutputScale): number | null {
  switch (scale) {
    case 'rq':
      return b.rq;
    case 'log2fc':
      return b.log2fc;
    case 'relexpr':
      return b.relExpr;
    case 'dct':
      return b.dCt;
  }
}

/** Central value and error-bar limits on the chosen scale. */
export function summaryValue(g: GroupSummary, scale: OutputScale): { mid: number; low: number; high: number } {
  switch (scale) {
    case 'rq':
      return { mid: g.rq, low: g.rqLow, high: g.rqHigh };
    case 'log2fc':
      return { mid: g.log2fc, low: g.log2fc - g.err, high: g.log2fc + g.err };
    case 'relexpr': {
      const m = g.meanDct;
      return { mid: Math.pow(2, -m), low: Math.pow(2, -(m + g.err)), high: Math.pow(2, -(m - g.err)) };
    }
    case 'dct':
      return { mid: g.meanDct, low: g.meanDct - g.err, high: g.meanDct + g.err };
  }
}

/** Whether values on this scale are ratios (log axis possible, baseline 1). */
export const isRatioScale = (scale: OutputScale) => scale === 'rq' || scale === 'relexpr';