# qPCR Tool

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.23395519.svg)](https://doi.org/10.5281/zenodo.23395519)

**Open the app: https://alexschulzcell.github.io/qpcr-tool/**

Browser app for relative quantification of qPCR data (ΔΔCt / 2^−ΔΔCt) from
**Thermo Fisher QuantStudio** exports, with validated statistics and
publication-ready figures.

**Drag in the export → choose reference and target genes → get figures, tables,
statistics and a methods paragraph.** All processing happens locally in the
browser; no data are uploaded.

## Features

- **Import**: QuantStudio `.xlsx/.xls/.csv/.txt` exports. Ct values are read from the
  `Results` sheet (header row detected automatically; `Undetermined`, comma decimals,
  `Omit` and instrument QC flags are handled). Several plates can be combined.
- **Design detection**: sample names are split into condition + biological replicate
  (`chKO2` → `chKO`, 2). Prefixes are proposed as *panels* (e.g. lineage) and the rest
  as *groups* (e.g. genotype); everything is editable.
- **Detection limit**: wells with Ct above a cutoff (default 40) are *not detected*; a
  sample needs a minimum number of detected replicates. Not-detected samples are
  excluded (default) or set to the cutoff (conservative estimate), always flagged.
- **Technical outliers**: distance from the replicate median (default, > 0.5 cycles),
  replicate SD, Dixon's Q test, or IQR (legacy); at most *n* removed per sample, and at
  least two replicates always kept. Wells can be excluded by clicking them.
- **Normalisation**: one or several reference genes (mean Ct = geometric mean of
  quantities), optional efficiency correction (Pfaffl), reference group per panel or
  pooled.
- **Output**: RQ (geometric mean, asymmetric error bars on the log scale), log2 fold
  change, 2^−ΔCt or ΔCt; SD, SEM or 95% CI.
- **Statistics on ΔCt**: Welch's t-test / Welch's ANOVA + Games-Howell or Holm-adjusted
  Welch tests vs. reference (recommended default); Student's t-test / ANOVA + Tukey HSD
  or Dunnett; paired t-tests for matched replicates; optional correction across genes
  (BH / Holm). The app explains which test is recommended and why.
- **QC**: plate map, technical replicate table, reference-gene stability across groups,
  NTC check.
- **Figures**: SVG (vector) and PNG at 300/600 dpi, journal column widths, Arial, pt font
  sizes, colour-blind-safe palette or greyscale, individual replicates, significance
  brackets.
- **Exports**: Excel workbook (summary, statistics, replicates, every well with its
  inclusion decision, Prism-ready tables, settings, methods), a **standalone R script
  that reproduces every number**, a methods paragraph with references, and a settings
  file to reload an analysis.

## Validation

The statistics are implemented in TypeScript and validated against R
(see [VALIDATION.md](VALIDATION.md)):

- distributions and tests vs. `pt`, `qt`, `ptukey`, `t.test`, `oneway.test`,
  `car::leveneTest`, `TukeyHSD`, `rstatix::games_howell_test`, `mvtnorm`/`multcomp`
  (Dunnett) and `p.adjust` — agreement to ≤ 1e-7;
- end to end: for several designs and settings, the generated R script is executed and
  must reproduce every group mean, RQ and p-value of the app.

Run the suite with `npm test` (R ≥ 4.0 with `jsonlite`, `multcomp`, `mvtnorm`, `rstatix`,
`car`). Real exports can be added locally with `QPCR_DATA_DIR=/path/to/exports npm test`.

## Citing

If you use the tool in a publication, cite the version you used (shown in the app and
in every export), e.g.:

> Zentgraf A. qPCR Tool v0.1.0 (2026). https://github.com/alexschulzcell/qpcr-tool.
> doi:10.5281/zenodo.23395520

Each release has its own version DOI on Zenodo; the concept DOI
[10.5281/zenodo.23395519](https://doi.org/10.5281/zenodo.23395519) always resolves to the
latest version. See [CITATION.cff](CITATION.cff).

Methods references: Livak & Schmittgen 2001 (2^−ΔΔCt); Pfaffl 2001 (efficiency
correction); Vandesompele et al. 2002 (multiple reference genes); Bustin et al. 2009
(MIQE).

## Development

```bash
npm install
npm run dev        # local development server
npm test           # validation suite
npm run build      # static build in dist/
```

Regenerate the R reference values with `Rscript scripts/make_r_reference.R`.

## Deployment (GitHub Pages)

1. Create a GitHub repository and push this folder to the `main` branch.
2. In the repository settings → *Pages*, set *Source* to **GitHub Actions**.
3. Every push to `main` runs the validation suite and, if it passes, publishes the app
   at `https://<user>.github.io/<repository>/`.

## Privacy

The app is a static web page. Files are parsed in the browser and never sent to a
server. Preferences (cutoffs, figure style) are remembered in the browser's local
storage.

## License

MIT — see [LICENSE](LICENSE).