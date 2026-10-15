import type { AnalysisResult, Settings } from '../analysis/types';
import { resolveFamily } from '../analysis/statsRunner';
import type { ParsedFile } from '../parse/quantstudio';

export const REFERENCES = {
  livak: 'Livak KJ, Schmittgen TD. Analysis of relative gene expression data using real-time quantitative PCR and the 2(-Delta Delta C(T)) method. Methods. 2001;25(4):402-408.',
  pfaffl: 'Pfaffl MW. A new mathematical model for relative quantification in real-time RT-PCR. Nucleic Acids Res. 2001;29(9):e45.',
  vandesompele: 'Vandesompele J, et al. Accurate normalization of real-time quantitative RT-PCR data by geometric averaging of multiple internal control genes. Genome Biol. 2002;3(7):research0034.',
  miqe: 'Bustin SA, et al. The MIQE guidelines: minimum information for publication of quantitative real-time PCR experiments. Clin Chem. 2009;55(4):611-622.',
  welch: 'Welch BL. The generalization of "Student\'s" problem when several different population variances are involved. Biometrika. 1947;34:28-35.',
  welchAnova: 'Welch BL. On the comparison of several mean values: an alternative approach. Biometrika. 1951;38:330-336.',
  gamesHowell: 'Games PA, Howell JF. Pairwise multiple comparison procedures with unequal n\'s and/or variances. J Educ Stat. 1976;1(2):113-125.',
  tukey: 'Tukey JW. Comparing individual means in the analysis of variance. Biometrics. 1949;5(2):99-114.',
  dunnett: 'Dunnett CW. A multiple comparison procedure for comparing several treatments with a control. J Am Stat Assoc. 1955;50:1096-1121.',
  holm: 'Holm S. A simple sequentially rejective multiple test procedure. Scand J Stat. 1979;6:65-70.',
  bh: 'Benjamini Y, Hochberg Y. Controlling the false discovery rate. J R Stat Soc B. 1995;57:289-300.',
  delacre: 'Delacre M, Lakens D, Leys C. Why psychologists should by default use Welch\'s t-test instead of Student\'s t-test. Int Rev Soc Psychol. 2017;30(1):92-101.',
};

const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** Draft of a methods paragraph matching the current settings. */
export function generateMethods(files: ParsedFile[], s: Settings, res: AnalysisResult, version: string) {
  const refs = new Set<keyof typeof REFERENCES>(['livak']);
  const parts: string[] = [];
  const instrument = [...new Set(files.map((f) => f.instrument).filter((x) => x && x !== 'synthetic'))];
  const nTech = Math.max(0, ...res.sampleTargets.map((x) => x.nTotal));

  parts.push(
    `Quantitative PCR was performed${instrument.length ? ` on a ${list(instrument)} (Thermo Fisher Scientific)` : ''} with ${nTech} technical replicates per sample. Cycle threshold (Ct) values were analysed with qPCR Tool v${version}.`,
  );

  // Detection
  parts.push(
    `Wells without amplification ("Undetermined") or with Ct > ${s.ctCutoff} were considered not detected. A gene was considered not detected in a sample when fewer than ${s.minDetected} technical replicates were detected; ${
      s.ndSampleMode === 'exclude'
        ? 'such samples were excluded from the analysis of that gene and are reported as not detected'
        : `for such samples, Ct was set to ${s.ctCutoff} (conservative estimate of expression)`
    }.`,
  );

  // Outliers
  const nOut = res.sampleTargets.reduce((a, x) => a + x.wells.filter((w) => w.status === 'outlier').length, 0);
  const nMan = res.sampleTargets.reduce((a, x) => a + x.wells.filter((w) => w.status === 'manual').length, 0);
  const nAll = res.sampleTargets.reduce((a, x) => a + x.nTotal, 0);
  const maxTxt = `at most ${s.maxOutliers} per sample and gene`;
  const outlierTxt: Record<Settings['outlierMethod'], string> = {
    none: 'All detected technical replicates were averaged.',
    median: `Technical replicates deviating by more than ${s.outlierThreshold} cycles from the median of their replicate group were excluded as technical outliers (${maxTxt}).`,
    sd: `When the standard deviation of technical replicates exceeded ${s.outlierThreshold} cycles, the replicate furthest from the median was excluded (${maxTxt}).`,
    dixon: `Technical outliers were identified with Dixon's Q test (α = 0.05; ${maxTxt}).`,
    iqr: `Technical replicates outside 1.5 × the interquartile range of their replicate group were excluded (${maxTxt}).`,
  };
  let o = outlierTxt[s.outlierMethod];
  if (s.outlierMethod !== 'none' || nMan > 0) {
    o += ` In total, ${nOut} of ${nAll} wells ${nOut === 1 ? 'was' : 'were'} excluded as technical outliers${nMan ? ` and ${nMan} ${nMan === 1 ? 'well was' : 'wells were'} excluded manually` : ''}.`;
  }
  parts.push(o);

  // Normalization
  const eff = Object.keys(s.efficiencies).some((g) => (s.efficiencies[g] ?? 100) !== 100);
  const hk = s.hkGenes;
  let norm = `Mean Ct values of technical replicates were normalized to ${
    hk.length > 1
      ? `the mean Ct of ${list(hk)}, corresponding to the geometric mean of their relative quantities`
      : hk[0] ?? 'the reference gene'
  } (ΔCt = Ct(target) − Ct(reference)).`;
  if (hk.length > 1) refs.add('vandesompele');
  const panelTxt = res.panels.length > 1 && s.referenceScope === 'panel' ? ' within each panel' : '';
  norm += ` Relative expression was calculated with the 2^−ΔΔCt method relative to the mean ΔCt of the ${s.referenceGroup} group${panelTxt}${
    eff ? ', using gene-specific amplification efficiencies (efficiency-corrected model)' : ''
  }.`;
  if (eff) refs.add('pfaffl');
  parts.push(norm);

  // Presentation
  const ebar = s.errorBar === 'sd' ? 'standard deviation' : s.errorBar === 'sem' ? 'standard error of the mean' : '95% confidence interval';
  const scale: Record<Settings['outputScale'], string> = {
    rq: `relative quantity (RQ, geometric mean of 2^−ΔΔCt) with error bars showing the ${ebar} computed on the log2 scale`,
    log2fc: `log2 fold change (mean of −ΔΔCt) ± ${ebar}`,
    relexpr: `expression relative to the reference gene (2^−ΔCt, geometric mean) with error bars showing the ${ebar} computed on the log2 scale`,
    dct: `ΔCt (mean ± ${ebar}); lower values indicate higher expression`,
  };
  const ns = res.summaries.map((x) => x.n);
  const nTxt = ns.length ? (Math.min(...ns) === Math.max(...ns) ? `n = ${ns[0]}` : `n = ${Math.min(...ns)}-${Math.max(...ns)}`) : '';
  parts.push(`Data are presented as ${scale[s.outputScale]}; dots represent biological replicates (${nTxt} per group).`);

  // Statistics
  const fam = resolveFamily(s.testFamily);
  const ks = [...new Set(res.stats.filter((x) => x.comparisons.length).map((x) => x.groups.length))];
  const stat: string[] = ['Statistical analysis was performed on ΔCt values.'];
  const two = ks.includes(2);
  const multi = ks.some((k) => k > 2);
  if (fam === 'welch') {
    if (two) {
      stat.push("Two groups were compared with Welch's unequal-variances t-test.");
      refs.add('welch');
    }
    if (multi) {
      refs.add('welchAnova');
      if (s.comparisons === 'allPairs') {
        stat.push("For more than two groups, Welch's one-way ANOVA was followed by the Games-Howell post-hoc test.");
        refs.add('gamesHowell');
      } else {
        stat.push(
          `For more than two groups, Welch's one-way ANOVA was followed by Welch's t-tests of each group against ${s.referenceGroup}, with Holm correction for multiple comparisons.`,
        );
        refs.add('welch');
        refs.add('holm');
      }
    }
  } else if (fam === 'classic') {
    if (two) stat.push("Two groups were compared with Student's two-sample t-test.");
    if (multi) {
      if (s.comparisons === 'allPairs') {
        stat.push('For more than two groups, one-way ANOVA was followed by the Tukey HSD post-hoc test.');
        refs.add('tukey');
      } else {
        stat.push(`For more than two groups, one-way ANOVA was followed by Dunnett's test against ${s.referenceGroup}.`);
        refs.add('dunnett');
      }
    }
  } else {
    stat.push('Biological replicates were matched by replicate number (paired design).');
    if (two) stat.push('Two groups were compared with a paired t-test.');
    if (multi) {
      stat.push('For more than two groups, pairwise paired t-tests with Holm correction were used.');
      refs.add('holm');
    }
  }
  if (s.multiGeneCorrection !== 'none' && s.targetGenes.length > 1) {
    stat.push(
      `P-values were additionally adjusted across all genes with the ${s.multiGeneCorrection === 'BH' ? 'Benjamini-Hochberg' : 'Holm'} method.`,
    );
    refs.add(s.multiGeneCorrection === 'BH' ? 'bh' : 'holm');
  }
  stat.push(`Tests were two-sided and p < ${s.alpha} was considered significant.`);
  stat.push(
    'Statistical computations were validated against R; a script reproducing all results is provided in the Supplementary Material.',
  );
  parts.push(stat.join(' '));

  return {
    text: parts.join(' '),
    references: [...refs].map((r) => REFERENCES[r]),
    citation: `qPCR Tool v${version}. Available at: <repository URL / DOI>`,
  };
}