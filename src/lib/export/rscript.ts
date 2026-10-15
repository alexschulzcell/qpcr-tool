import type { Design } from '../analysis/design';
import type { AnalysisResult, Settings } from '../analysis/types';
import { resolveFamily } from '../analysis/statsRunner';
import type { ParsedFile } from '../parse/quantstudio';

const q = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const rVec = (xs: string[]) => `c(${xs.map(q).join(', ')})`;

/**
 * Generate a standalone R script that recomputes all results from the well-level
 * decisions taken in the app (detection, outliers, manual exclusions).
 */
export function generateRScript(
  files: ParsedFile[],
  design: Design,
  s: Settings,
  res: AnalysisResult,
  version: string,
): string {
  const family = resolveFamily(s.testFamily);
  const wellRows = res.sampleTargets.flatMap((st) =>
    st.wells.map((w) =>
      [w.well.sample, w.well.target, w.well.fileName + ':' + w.well.position, w.well.ct === null ? 'NA' : String(w.well.ct), w.status]
        .map(csvCell)
        .join(','),
    ),
  );
  const condMap = new Map(design.conditions.map((c) => [c.name, c]));
  const designRows = design.samples
    .filter((x) => x.include && condMap.get(x.condition)?.include)
    .map((x) => {
      const c = condMap.get(x.condition)!;
      return [x.sample, c.panel, c.group, x.biorep].map(csvCell).join(',');
    });
  const genes = [...new Set([...s.hkGenes, ...s.targetGenes])];
  const eff = genes.map((g) => `${q(g)} = ${s.efficiencies[g] ?? 100}`).join(', ');
  const groupOrder = `setNames(list(${res.panels.map((p) => rVec(res.groupsByPanel[p])).join(', ')}), ${rVec(res.panels)})`;

  return `# =============================================================================
# qPCR Tool v${version} - reproducibility script
# Generated ${new Date().toISOString().slice(0, 10)} from: ${files.map((f) => f.name).join('; ')}
#
# This script recomputes all delta Ct / delta-delta Ct values, fold changes and
# statistics from the well-level Ct values and the inclusion decisions made in
# the app (detection cutoff, technical outliers, manual exclusions), using base R
# (and the multcomp package for Dunnett's test). Run it with R >= 4.0:
#   Rscript this_file.R
# =============================================================================

# ---- Well-level data and inclusion decisions ---------------------------------
# status: used | nd (not detected / above cutoff) | nd-sample (sample not detected)
#         | outlier (technical outlier) | manual (excluded by hand) | omitted
wells <- read.csv(text = "sample,target,well,ct,status
${wellRows.join('\n')}
", stringsAsFactors = FALSE, check.names = FALSE)

design <- read.csv(text = "sample,panel,group,biorep
${designRows.join('\n')}
", stringsAsFactors = FALSE, colClasses = "character", na.strings = character(0))

# ---- Settings ----------------------------------------------------------------
hk_genes      <- ${rVec(s.hkGenes)}
target_genes  <- ${rVec(s.targetGenes)}
efficiency    <- c(${eff})  # amplification efficiency in percent
ct_cutoff     <- ${s.ctCutoff}
nd_mode       <- ${q(s.ndSampleMode)}   # "exclude" or "impute" (Ct set to cutoff)
ref_group     <- ${q(s.referenceGroup)}
ref_scope     <- ${q(s.referenceScope)}     # "panel" or "pooled"
test_family   <- ${q(family)}     # "welch", "classic" or "paired"
comparisons   <- ${q(s.comparisons)}
group_order   <- ${groupOrder}
write_output  <- TRUE

log2E <- function(g) log2(1 + efficiency[[g]] / 100)

# ---- Mean Ct per sample and gene ---------------------------------------------
sample_ct <- function(smp, gene) {
  w <- wells[wells$sample == smp & wells$target == gene, ]
  used <- w$ct[w$status == "used"]
  if (length(used) > 0) return(list(ct = mean(used), nd = FALSE))
  if (any(w$status %in% c("nd", "nd-sample"))) return(list(ct = NA_real_, nd = TRUE))
  list(ct = NA_real_, nd = FALSE)
}

rows <- list()
for (tg in target_genes) for (i in seq_len(nrow(design))) {
  smp <- design$sample[i]
  if (!any(wells$sample == smp & wells$target == tg)) next
  hk <- lapply(hk_genes, function(h) sample_ct(smp, h))
  hk_ok <- all(sapply(hk, function(x) !is.na(x$ct)))
  w_hk <- if (hk_ok) mean(mapply(function(x, h) x$ct * log2E(h), hk, hk_genes)) else NA_real_
  t_ct <- sample_ct(smp, tg)
  ct_t <- t_ct$ct
  if (is.na(ct_t) && t_ct$nd && nd_mode == "impute") ct_t <- ct_cutoff
  rows[[length(rows) + 1]] <- data.frame(
    target = tg, sample = smp, panel = design$panel[i], group = design$group[i],
    biorep = design$biorep[i], ct_target = ct_t,
    ct_hk = if (hk_ok) mean(sapply(hk, function(x) x$ct)) else NA_real_,
    dCt = ct_t * log2E(tg) - w_hk, stringsAsFactors = FALSE)
}
res <- do.call(rbind, rows)
res <- res[!is.na(res$dCt), ]

# ---- Reference and delta-delta Ct --------------------------------------------
res$ddCt <- NA_real_
for (tg in target_genes) {
  pooled <- res$dCt[res$target == tg & res$group == ref_group]
  for (p in unique(res$panel[res$target == tg])) {
    idx <- res$target == tg & res$panel == p
    ref <- if (ref_scope == "pooled") pooled else res$dCt[idx & res$group == ref_group]
    if (length(ref) == 0) ref <- pooled
    if (length(ref) > 0) res$ddCt[idx] <- res$dCt[idx] - mean(ref)
  }
}
res$RQ <- 2^(-res$ddCt)
res$log2FC <- -res$ddCt

summary_tab <- do.call(rbind, lapply(split(res, list(res$target, res$panel, res$group), drop = TRUE), function(d) {
  data.frame(target = d$target[1], panel = d$panel[1], group = d$group[1], n = nrow(d),
             mean_dCt = mean(d$dCt), sd_dCt = if (nrow(d) > 1) sd(d$dCt) else NA,
             RQ = 2^(-mean(d$ddCt)), log2FC = -mean(d$ddCt))
}))
rownames(summary_tab) <- NULL
cat("\\n==== Group summary (RQ = 2^-mean(ddCt), geometric mean) ====\\n")
print(summary_tab, digits = 6)

# ---- Statistics on delta Ct --------------------------------------------------
games_howell <- function(vals, names) {
  k <- length(vals); out <- NULL
  for (i in 1:(k - 1)) for (j in (i + 1):k) {
    a <- var(vals[[i]]) / length(vals[[i]]); b <- var(vals[[j]]) / length(vals[[j]])
    df <- (a + b)^2 / (a^2 / (length(vals[[i]]) - 1) + b^2 / (length(vals[[j]]) - 1))
    est <- mean(vals[[j]]) - mean(vals[[i]])
    p <- ptukey(abs(est) / sqrt(a + b) * sqrt(2), k, df, lower.tail = FALSE)
    out <- rbind(out, data.frame(group1 = names[i], group2 = names[j], diff_dCt = est, p = p, p_adj = p))
  }
  out
}
pair_vals <- function(d, g1, g2) {
  a <- d[d$group == g1, ]; b <- d[d$group == g2, ]
  m <- merge(a, b, by = "biorep", suffixes = c(".1", ".2"))
  list(x = m$dCt.2, y = m$dCt.1)
}

stats <- NULL
for (tg in target_genes) for (pi in seq_along(group_order)) {
  p <- names(group_order)[pi]
  d <- res[res$target == tg & res$panel == p, ]
  grp <- group_order[[pi]]
  grp <- grp[sapply(grp, function(g) sum(d$group == g) >= 2)]
  if (length(grp) < 2) next
  d <- d[d$group %in% grp, ]
  vals <- lapply(grp, function(g) d$dCt[d$group == g])
  mode <- if (comparisons == "vsReference" && ref_group %in% grp) "vsReference" else "allPairs"
  k <- length(grp)
  rows <- NULL
  if (k == 2) {
    g1 <- if (ref_group %in% grp) ref_group else grp[1]; g2 <- setdiff(grp, g1)
    tt <- if (test_family == "paired") { pv <- pair_vals(d, g1, g2); t.test(pv$x, pv$y, paired = TRUE) }
          else t.test(d$dCt[d$group == g2], d$dCt[d$group == g1], var.equal = test_family == "classic")
    rows <- data.frame(group1 = g1, group2 = g2, diff_dCt = unname(if (test_family == "paired") tt$estimate else tt$estimate[1] - tt$estimate[2]),
                       p = tt$p.value, p_adj = tt$p.value)
  } else {
    d$g <- factor(d$group, levels = grp)
    if (test_family != "paired") {
      om <- oneway.test(dCt ~ g, data = d, var.equal = test_family == "classic")
      cat(sprintf("\\n%s [%s]: %s F(%.0f, %.3f) = %.4f, p = %.4g\\n", tg, p,
                  if (test_family == "classic") "One-way ANOVA" else "Welch ANOVA",
                  om$parameter[1], om$parameter[2], om$statistic, om$p.value))
    }
    if (test_family == "classic" && mode == "allPairs") {
      tk <- TukeyHSD(aov(dCt ~ g, data = d))$g
      nm <- combn(grp, 2)  # TukeyHSD rows are ordered as combn(levels, 2): "level j - level i"
      rows <- data.frame(group1 = nm[1, ], group2 = nm[2, ], diff_dCt = unname(tk[, "diff"]),
                         p = unname(tk[, "p adj"]), p_adj = unname(tk[, "p adj"]))
    } else if (test_family == "classic") {
      if (!requireNamespace("multcomp", quietly = TRUE)) stop("Install the multcomp package for Dunnett's test")
      d$g <- relevel(d$g, ref = ref_group)
      gl <- summary(multcomp::glht(aov(dCt ~ g, data = d), linfct = multcomp::mcp(g = "Dunnett")))
      rows <- data.frame(group1 = ref_group, group2 = setdiff(levels(d$g), ref_group),
                         diff_dCt = unname(gl$test$coefficients), p = unname(gl$test$pvalues), p_adj = unname(gl$test$pvalues))
    } else if (test_family == "welch" && mode == "allPairs") {
      rows <- games_howell(vals, grp)
    } else {
      pairs <- if (mode == "vsReference") lapply(setdiff(grp, ref_group), function(g) c(ref_group, g)) else combn(grp, 2, simplify = FALSE)
      for (pr in pairs) {
        tt <- if (test_family == "paired") { pv <- pair_vals(d, pr[1], pr[2]); t.test(pv$x, pv$y, paired = TRUE) }
              else t.test(d$dCt[d$group == pr[2]], d$dCt[d$group == pr[1]])
        est <- if (test_family == "paired") tt$estimate else tt$estimate[1] - tt$estimate[2]
        rows <- rbind(rows, data.frame(group1 = pr[1], group2 = pr[2], diff_dCt = unname(est), p = tt$p.value, p_adj = NA))
      }
      rows$p_adj <- p.adjust(rows$p, "holm")
    }
  }
  rows$target <- tg; rows$panel <- p
  rows$fold_change <- 2^(-rows$diff_dCt)
  stats <- rbind(stats, rows)
}
if (!is.null(stats)) {
  stats <- stats[, c("target", "panel", "group1", "group2", "diff_dCt", "fold_change", "p", "p_adj")]
  rownames(stats) <- NULL
${
  s.multiGeneCorrection !== 'none' && s.targetGenes.length > 1
    ? `  stats$p_final <- p.adjust(stats$p_adj, ${q(s.multiGeneCorrection)})  # correction across genes\n`
    : ''
}  cat("\\n==== Comparisons (fold change of group2 relative to group1) ====\\n")
  print(stats, digits = 6)
}

if (write_output) {
  write.csv(res, "qpcr_biological_replicates.csv", row.names = FALSE)
  write.csv(summary_tab, "qpcr_group_summary.csv", row.names = FALSE)
  if (!is.null(stats)) write.csv(stats, "qpcr_statistics.csv", row.names = FALSE)
}
`;
}