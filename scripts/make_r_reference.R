# Generates reference values for the statistics validation suite.
# Run:  Rscript scripts/make_r_reference.R
# Output: tests/fixtures/r_reference.json (consumed by tests/stats.test.ts)
suppressPackageStartupMessages({
  library(jsonlite)
  library(multcomp)
  library(mvtnorm)
  library(rstatix)
  library(car)
})

set.seed(20261015)

make_dataset <- function(k, ns, means, sds) {
  lapply(seq_len(k), function(i) round(rnorm(ns[i], means[i], sds[i]), 4))
}

designs <- list(
  list(k = 2, ns = c(3, 3), means = c(5, 6.5), sds = c(0.3, 0.6)),
  list(k = 2, ns = c(4, 3), means = c(8, 7.2), sds = c(0.5, 0.2)),
  list(k = 2, ns = c(5, 5), means = c(2, 2.1), sds = c(1, 1)),
  list(k = 3, ns = c(3, 3, 3), means = c(5, 6, 7.5), sds = c(0.4, 0.4, 0.8)),
  list(k = 3, ns = c(4, 3, 5), means = c(10, 9, 10.5), sds = c(0.3, 0.9, 0.5)),
  list(k = 4, ns = c(3, 3, 3, 3), means = c(4, 4.5, 6, 3), sds = c(0.5, 0.5, 0.5, 0.5)),
  list(k = 4, ns = c(4, 4, 3, 6), means = c(1, 2, 1.5, 3), sds = c(0.2, 0.7, 0.4, 1.2)),
  list(k = 5, ns = c(3, 3, 3, 3, 3), means = c(6, 6.2, 7, 5, 6.5), sds = c(0.6, 0.3, 0.5, 0.4, 0.9))
)

cases <- lapply(designs, function(d) {
  g <- make_dataset(d$k, d$ns, d$means, d$sds)
  y <- unlist(g)
  f <- factor(rep(paste0("G", seq_len(d$k)), times = d$ns), levels = paste0("G", seq_len(d$k)))
  df <- data.frame(y = y, g = f)
  out <- list(groups = g)

  tw <- t.test(g[[1]], g[[2]])
  ts <- t.test(g[[1]], g[[2]], var.equal = TRUE)
  out$welch <- list(statistic = unname(tw$statistic), df = unname(tw$parameter), p = tw$p.value,
                    ciLow = tw$conf.int[1], ciHigh = tw$conf.int[2])
  out$student <- list(statistic = unname(ts$statistic), df = unname(ts$parameter), p = ts$p.value,
                      ciLow = ts$conf.int[1], ciHigh = ts$conf.int[2])
  if (length(g[[1]]) == length(g[[2]])) {
    tp <- t.test(g[[1]], g[[2]], paired = TRUE)
    out$paired <- list(statistic = unname(tp$statistic), df = unname(tp$parameter), p = tp$p.value,
                       ciLow = tp$conf.int[1], ciHigh = tp$conf.int[2])
  }

  if (d$k >= 2) {
    a <- oneway.test(y ~ g, data = df, var.equal = TRUE)
    w <- oneway.test(y ~ g, data = df, var.equal = FALSE)
    out$anova <- list(statistic = unname(a$statistic), df1 = unname(a$parameter[1]),
                      df2 = unname(a$parameter[2]), p = a$p.value)
    out$welchAnova <- list(statistic = unname(w$statistic), df1 = unname(w$parameter[1]),
                           df2 = unname(w$parameter[2]), p = w$p.value)
    lv <- leveneTest(y ~ g, data = df, center = median)
    out$brownForsythe <- list(statistic = lv$`F value`[1], p = lv$`Pr(>F)`[1])
  }

  if (d$k >= 3) {
    fit <- aov(y ~ g, data = df)
    tk <- TukeyHSD(fit, conf.level = 0.95)$g
    out$tukey <- lapply(seq_len(nrow(tk)), function(r) list(
      comparison = rownames(tk)[r], estimate = tk[r, "diff"], ciLow = tk[r, "lwr"],
      ciHigh = tk[r, "upr"], pAdj = tk[r, "p adj"]))

    # Games-Howell: textbook formula with base R ptukey (unrounded),
    # cross-checked against rstatix::games_howell_test (which rounds p.adj).
    gh <- games_howell_test(df, y ~ g, conf.level = 0.95)
    pairs <- combn(d$k, 2)
    out$gamesHowell <- lapply(seq_len(ncol(pairs)), function(r) {
      i <- pairs[1, r]; j <- pairs[2, r]
      a <- var(g[[i]]) / length(g[[i]]); b <- var(g[[j]]) / length(g[[j]])
      se <- sqrt(a + b)
      dfw <- (a + b)^2 / (a^2 / (length(g[[i]]) - 1) + b^2 / (length(g[[j]]) - 1))
      est <- mean(g[[j]]) - mean(g[[i]])
      crit <- qtukey(0.95, d$k, dfw) / sqrt(2)
      list(comparison = paste0("G", j, "-G", i), estimate = est,
           ciLow = est - crit * se, ciHigh = est + crit * se,
           pAdj = ptukey(abs(est) / se * sqrt(2), d$k, dfw, lower.tail = FALSE),
           pAdjRstatix = gh$p.adj[r])
    })

    # Dunnett, control = G1: precise reference via mvtnorm with tight tolerance
    n <- d$ns
    mse <- sum(sapply(g, function(x) sum((x - mean(x))^2))) / (sum(n) - d$k)
    dfe <- sum(n) - d$k
    lam <- sqrt(n[-1] / (n[-1] + n[1]))
    R <- outer(lam, lam); diag(R) <- 1
    tstat <- sapply(2:d$k, function(j) (mean(g[[j]]) - mean(g[[1]])) / sqrt(mse * (1 / n[j] + 1 / n[1])))
    padj <- sapply(tstat, function(t) {
      1 - pmvt(lower = rep(-abs(t), d$k - 1), upper = rep(abs(t), d$k - 1), df = dfe, corr = R,
               algorithm = GenzBretz(maxpts = 5e5, abseps = 1e-7, releps = 0))[1]
    })
    crit <- qmvt(0.95, tail = "both.tails", df = dfe, corr = R,
                 algorithm = GenzBretz(maxpts = 5e5, abseps = 1e-7, releps = 0))$quantile
    # Cross-check with multcomp (randomized, lower precision)
    gl <- summary(glht(fit, linfct = mcp(g = "Dunnett")))
    out$dunnett <- lapply(seq_along(tstat), function(r) list(
      comparison = paste0("G", r + 1, "-G1"), statistic = tstat[r], pAdj = padj[r],
      pAdjMultcomp = unname(gl$test$pvalues[r]), crit = crit))
  }
  out
})

pvec <- c(0.01, 0.04, 0.03, 0.2, 0.005, 0.5, 0.049)
padjust <- list(
  p = pvec,
  holm = p.adjust(pvec, "holm"),
  BH = p.adjust(pvec, "BH"),
  bonferroni = p.adjust(pvec, "bonferroni")
)

grid <- expand.grid(q = c(0.5, 1.5, 2.8, 3.5, 4.2, 6), k = c(2, 3, 4, 6), df = c(2, 4, 9, 30, 200))
ptukey_ref <- lapply(seq_len(nrow(grid)), function(r) list(
  q = grid$q[r], k = grid$k[r], df = grid$df[r],
  p = ptukey(grid$q[r], grid$k[r], grid$df[r])))

tgrid <- expand.grid(t = c(-4, -1.3, 0.2, 2.1, 7.5), df = c(1.5, 2, 3.7, 10, 120))
pt_ref <- lapply(seq_len(nrow(tgrid)), function(r) list(
  t = tgrid$t[r], df = tgrid$df[r], p = 2 * pt(-abs(tgrid$t[r]), tgrid$df[r]),
  q975 = qt(0.975, tgrid$df[r])))

ref <- list(
  generated = format(Sys.time(), "%Y-%m-%d"),
  R = R.version.string,
  cases = cases,
  padjust = padjust,
  ptukey = ptukey_ref,
  pt = pt_ref
)
write_json(ref, "tests/fixtures/r_reference.json", auto_unbox = TRUE, digits = NA, pretty = TRUE)
cat("Wrote tests/fixtures/r_reference.json\n")