import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ptTwoSided, qt, ptukey } from '../src/lib/stats/distributions';
import {
  tTest,
  pairedTTest,
  oneWayAnova,
  welchAnova,
  brownForsythe,
  tukeyHSD,
  gamesHowell,
  dunnett,
  pAdjust,
} from '../src/lib/stats/tests';

const ref = JSON.parse(readFileSync(new URL('./fixtures/r_reference.json', import.meta.url), 'utf8'));

/** Relative/absolute closeness: |a - b| <= tol * max(1, |b|). */
function close(a: number, b: number, tol: number) {
  expect(Math.abs(a - b)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(b)));
}

const TOL = 1e-8;

describe(`distributions vs ${ref.R}`, () => {
  it('Student t two-sided p and quantiles', () => {
    for (const r of ref.pt) {
      close(ptTwoSided(r.t, r.df), r.p, TOL);
      close(qt(0.975, r.df), r.q975, 1e-9);
    }
  });
  it('studentized range ptukey', () => {
    for (const r of ref.ptukey) close(ptukey(r.q, r.k, r.df), r.p, 1e-9);
  });
});

describe('hypothesis tests vs R', () => {
  ref.cases.forEach((c: any, idx: number) => {
    const g: number[][] = c.groups.map((x: number | number[]) => (Array.isArray(x) ? x : [x]));
    const label = `case ${idx + 1} (k=${g.length}, n=${g.map((x) => x.length).join('/')})`;

    it(`${label}: Welch, Student, paired t-tests`, () => {
      const w = tTest(g[0], g[1], false);
      close(w.statistic, c.welch.statistic, TOL);
      close(w.df, c.welch.df, TOL);
      close(w.p, c.welch.p, TOL);
      close(w.ciLow, c.welch.ciLow, 1e-8);
      close(w.ciHigh, c.welch.ciHigh, 1e-8);
      const s = tTest(g[0], g[1], true);
      close(s.statistic, c.student.statistic, TOL);
      close(s.p, c.student.p, TOL);
      close(s.ciLow, c.student.ciLow, 1e-8);
      if (c.paired) {
        const p = pairedTTest(g[0], g[1]);
        close(p.statistic, c.paired.statistic, TOL);
        close(p.p, c.paired.p, TOL);
        close(p.ciHigh, c.paired.ciHigh, 1e-8);
      }
    });

    it(`${label}: ANOVA, Welch ANOVA, Brown-Forsythe`, () => {
      const a = oneWayAnova(g);
      close(a.statistic, c.anova.statistic, TOL);
      close(a.p, c.anova.p, TOL);
      const w = welchAnova(g);
      close(w.statistic, c.welchAnova.statistic, TOL);
      close(w.df2, c.welchAnova.df2, TOL);
      close(w.p, c.welchAnova.p, TOL);
      const bf = brownForsythe(g);
      close(bf.statistic, c.brownForsythe.statistic, TOL);
      close(bf.p, c.brownForsythe.p, TOL);
    });

    if (c.tukey) {
      it(`${label}: Tukey HSD`, () => {
        const t = tukeyHSD(g);
        expect(t.length).toBe(c.tukey.length);
        t.forEach((row, r) => {
          expect(`G${row.j + 1}-G${row.i + 1}`).toBe(c.tukey[r].comparison);
          close(row.estimate, c.tukey[r].estimate, TOL);
          close(row.pAdj, c.tukey[r].pAdj, 1e-7);
          close(row.ciLow, c.tukey[r].ciLow, 1e-6);
          close(row.ciHigh, c.tukey[r].ciHigh, 1e-6);
        });
      });

      it(`${label}: Games-Howell`, () => {
        const t = gamesHowell(g);
        t.forEach((row, r) => {
          expect(`G${row.j + 1}-G${row.i + 1}`).toBe(c.gamesHowell[r].comparison);
          close(row.estimate, c.gamesHowell[r].estimate, TOL);
          close(row.pAdj, c.gamesHowell[r].pAdj, 1e-7);
          // rstatix rounds p.adj to 3 decimals
          expect(Math.abs(row.pAdj - c.gamesHowell[r].pAdjRstatix)).toBeLessThanOrEqual(5.01e-4);
          close(row.ciLow, c.gamesHowell[r].ciLow, 1e-6);
        });
      });

      it(`${label}: Dunnett vs control`, () => {
        const t = dunnett(g, 0);
        t.forEach((row, r) => {
          close(row.statistic, c.dunnett[r].statistic, TOL);
          close(row.pAdj, c.dunnett[r].pAdj, 2e-6);
          close(row.pAdj, c.dunnett[r].pAdjMultcomp, 2e-3);
        });
      });
    }
  });
});

describe('p-value adjustment vs R p.adjust', () => {
  it('holm, BH, bonferroni', () => {
    const p = ref.padjust.p;
    pAdjust(p, 'holm').forEach((v, i) => close(v, ref.padjust.holm[i], 1e-12));
    pAdjust(p, 'BH').forEach((v, i) => close(v, ref.padjust.BH[i], 1e-12));
    pAdjust(p, 'bonferroni').forEach((v, i) => close(v, ref.padjust.bonferroni[i], 1e-12));
  });
});