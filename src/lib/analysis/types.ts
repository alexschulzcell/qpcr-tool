import type { Well } from '../parse/quantstudio';

/** A condition = a unique sample-name stem (sample name without the replicate number). */
export interface Condition {
  name: string;
  /** Optional stratum (e.g. cell lineage). Statistics and plots are split by panel. */
  panel: string;
  /** Comparison group within a panel (e.g. genotype / treatment). */
  group: string;
  include: boolean;
}

export interface SampleInfo {
  sample: string;
  condition: string;
  /** Biological replicate id; used to match pairs in a paired design. */
  biorep: string;
  include: boolean;
}

export type OutlierMethod = 'none' | 'median' | 'sd' | 'dixon' | 'iqr';
export type TestFamily = 'auto' | 'welch' | 'classic' | 'paired';
export type OutputScale = 'rq' | 'log2fc' | 'relexpr' | 'dct';

export interface Settings {
  hkGenes: string[];
  targetGenes: string[];
  /** Amplification efficiency in percent per gene (100 = perfect doubling). Missing = 100. */
  efficiencies: Record<string, number>;

  /** Wells with Ct above this value count as not detected. */
  ctCutoff: number;
  /** Mean Ct above this value is flagged as low confidence. */
  lowConfidenceCt: number;
  /** Minimum number of detected technical replicates for a sample to count as detected. */
  minDetected: number;
  /** What to do with a biological replicate whose target is not detected. */
  ndSampleMode: 'exclude' | 'impute';
  /** Exclude wells flagged "Omit" in the instrument software. */
  respectOmit: boolean;

  outlierMethod: OutlierMethod;
  /** Threshold in cycles (median: max deviation from median; sd: max replicate SD). */
  outlierThreshold: number;
  /** Maximum number of technical replicates removed per sample and target. */
  maxOutliers: number;
  /** Replicate SD above this value is flagged. */
  highSdWarn: number;
  /** Wells excluded by hand (Well.id). */
  manualExcluded: string[];

  referenceGroup: string;
  /** Reference mean computed within each panel or pooled across panels. */
  referenceScope: 'panel' | 'pooled';

  outputScale: OutputScale;
  errorBar: 'sd' | 'sem' | 'ci95';

  testFamily: TestFamily;
  comparisons: 'vsReference' | 'allPairs';
  alpha: number;
  /** Correction across target genes (in addition to within-gene post-hoc correction). */
  multiGeneCorrection: 'none' | 'holm' | 'BH';
}

export const DEFAULT_SETTINGS: Settings = {
  hkGenes: [],
  targetGenes: [],
  efficiencies: {},
  ctCutoff: 40,
  lowConfidenceCt: 35,
  minDetected: 2,
  ndSampleMode: 'exclude',
  respectOmit: true,
  outlierMethod: 'median',
  outlierThreshold: 0.5,
  maxOutliers: 1,
  highSdWarn: 0.5,
  manualExcluded: [],
  referenceGroup: '',
  referenceScope: 'panel',
  outputScale: 'rq',
  errorBar: 'sd',
  testFamily: 'auto',
  comparisons: 'vsReference',
  alpha: 0.05,
  multiGeneCorrection: 'none',
};

export type WellStatus = 'used' | 'nd' | 'omitted' | 'manual' | 'outlier' | 'nd-sample';

export interface WellResult {
  well: Well;
  status: WellStatus;
  reason: string;
}

export interface SampleTargetResult {
  sample: string;
  target: string;
  wells: WellResult[];
  nTotal: number;
  /** Wells not excluded manually or by the Omit flag. */
  nConsidered: number;
  nDetected: number;
  nUsed: number;
  meanCt: number | null;
  sdCt: number | null;
  detected: boolean;
  /** Ct imputed at the cutoff because the target was not detected. */
  imputed: boolean;
  lowConfidence: boolean;
  highSd: boolean;
}

export interface BioRepResult {
  target: string;
  sample: string;
  condition: string;
  panel: string;
  group: string;
  biorep: string;
  ctTarget: number | null;
  ctHK: number | null;
  /** Efficiency-weighted delta Ct on the log2 scale (= classic delta Ct when E = 100 %). */
  dCt: number | null;
  ddCt: number | null;
  rq: number | null;
  log2fc: number | null;
  relExpr: number | null;
  /** Used in the statistics and summaries. */
  valid: boolean;
  notDetected: boolean;
  imputed: boolean;
  flags: string[];
}

export interface GroupSummary {
  target: string;
  panel: string;
  group: string;
  isReference: boolean;
  n: number;
  meanDct: number;
  sdDct: number;
  meanDdct: number;
  /** Geometric-mean RQ = 2^-mean(ddCt) */
  rq: number;
  /** Error bar limits on the RQ scale (asymmetric, from the log2 scale). */
  rqLow: number;
  rqHigh: number;
  log2fc: number;
  /** Half-width of the error bar on the log2 / delta Ct scale. */
  err: number;
  values: BioRepResult[];
}

export interface Comparison {
  group1: string;
  group2: string;
  /** mean dCt(group2) - mean dCt(group1) = ddCt of group2 relative to group1 */
  diffDct: number;
  /** 2^-diffDct: fold change of group2 relative to group1 */
  foldChange: number;
  fcLow: number;
  fcHigh: number;
  statistic: number;
  df: number;
  p: number;
  /** After within-gene post-hoc adjustment. */
  pAdj: number;
  /** After additional correction across genes (if enabled). */
  pFinal: number;
  method: string;
}

export interface PanelStats {
  target: string;
  panel: string;
  groups: string[];
  n: number[];
  family: Exclude<TestFamily, 'auto'>;
  omnibus?: { method: string; statistic: number; df1: number; df2: number; p: number };
  variance?: { method: string; statistic: number; p: number };
  comparisons: Comparison[];
  testName: string;
  notes: string[];
}

export interface HKStability {
  gene: string;
  panel: string;
  groups: { group: string; meanCt: number; sdCt: number; n: number }[];
  range: number;
  p: number | null;
  warn: boolean;
}

export interface AnalysisResult {
  sampleTargets: SampleTargetResult[];
  bioreps: BioRepResult[];
  summaries: GroupSummary[];
  stats: PanelStats[];
  hkStability: HKStability[];
  warnings: string[];
  panels: string[];
  groupsByPanel: Record<string, string[]>;
}