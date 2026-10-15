/**
 * Probability distributions used by the statistical tests.
 *
 * Implementations follow standard numerical references:
 *  - log-gamma: Lanczos approximation (g = 7, n = 9)
 *  - regularized incomplete beta / gamma: continued fractions (modified Lentz),
 *    as in Press et al., Numerical Recipes, 3rd ed., sections 6.2 and 6.4
 *  - studentized range (ptukey): port of R nmath/ptukey.c
 *    (Copenhaver and Holland 1988, Gauss-Legendre quadrature)
 *  - Dunnett: one-factor representation of the multivariate t (Dunnett 1955)
 *
 * All functions are validated against R in tests/stats.test.ts.
 */

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
];

export function lgamma(x: number): number {
  if (x < 0.5) {
    return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  }
  x -= 1;
  let a = LANCZOS[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

const EPS = 1e-16;
const FPMIN = 1e-300;
const MAX_ITER = 10000;

/** Continued fraction for the incomplete beta function (modified Lentz). */
function betacf(a: number, b: number, x: number): number {
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAX_ITER; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularized incomplete beta function I_x(a, b). */
export function ibeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbt = lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x);
  const bt = Math.exp(lbt);
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a;
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

function gammaSeries(a: number, x: number): number {
  let ap = a;
  let sum = 1 / a;
  let del = sum;
  for (let n = 0; n < MAX_ITER; n++) {
    ap += 1;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * EPS) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - lgamma(a));
}

function gammaCF(a: number, x: number): number {
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= MAX_ITER; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
}

/** Regularized upper incomplete gamma Q(a, x). */
export function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  if (x < a + 1) return 1 - gammaSeries(a, x);
  return gammaCF(a, x);
}

/** Normal CDF. */
export function pnorm(x: number, mean = 0, sd = 1): number {
  const z = (x - mean) / sd;
  if (!Number.isFinite(z)) return z > 0 ? 1 : 0;
  const q = 0.5 * gammaQ(0.5, (z * z) / 2); // P(Z > |z|)
  return z >= 0 ? 1 - q : q;
}

/** Student t: two-sided p-value P(|T| > |t|). */
export function ptTwoSided(t: number, df: number): number {
  if (!Number.isFinite(t)) return 0;
  return ibeta(df / (df + t * t), df / 2, 0.5);
}

/** Student t CDF. */
export function pt(t: number, df: number): number {
  const tail = 0.5 * ptTwoSided(t, df);
  return t >= 0 ? 1 - tail : tail;
}

/** F distribution upper tail P(F > f). */
export function pfUpper(f: number, df1: number, df2: number): number {
  if (f <= 0) return 1;
  if (!Number.isFinite(f)) return 0;
  return ibeta(df2 / (df2 + df1 * f), df2 / 2, df1 / 2);
}

/** Monotone root finder (bisection with bracket expansion). */
function bisect(f: (x: number) => number, lo: number, hi: number, tol = 1e-12): number {
  let flo = f(lo);
  let fhi = f(hi);
  let guard = 0;
  while (flo * fhi > 0 && guard++ < 60) {
    hi *= 2;
    fhi = f(hi);
  }
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi);
    if (Math.abs(hi - lo) < tol * Math.max(1, Math.abs(mid))) return mid;
    const fm = f(mid);
    if (flo * fm <= 0) {
      hi = mid;
    } else {
      lo = mid;
      flo = fm;
    }
  }
  return 0.5 * (lo + hi);
}

/** Student t quantile. */
export function qt(p: number, df: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p === 0.5) return 0;
  if (p < 0.5) return -qt(1 - p, df);
  return bisect((x) => pt(x, df) - p, 0, 10);
}

// ---------------------------------------------------------------------------
// Studentized range distribution: port of R nmath/ptukey.c
// ---------------------------------------------------------------------------

const XLEG = [
  0.981560634246719250690549090149, 0.904117256370474856678465866119,
  0.769902674194304687036893833213, 0.587317954286617447296702418941,
  0.367831498998180193752691536644, 0.125233408511468915472441369464,
];
const ALEG = [
  0.047175336386511827194615961485, 0.106939325995318430960254718194,
  0.160078328543346226334652529543, 0.20316742672306592174906445581,
  0.233492536538354808760849898925, 0.249147045813402785000562436043,
];

function wprob(w: number, rr: number, cc: number): number {
  const nleg = 12;
  const ihalf = 6;
  const C1 = -30;
  const C2 = -50;
  const C3 = 60;
  const bb = 8;
  const wlar = 3;

  const qsqz = w * 0.5;
  if (qsqz >= bb) return 1;

  let prW = 2 * pnorm(qsqz) - 1;
  prW = prW >= Math.exp(C2 / cc) ? Math.pow(prW, cc) : 0;

  const wincr = w > wlar ? 2 : 3;
  let blb = qsqz;
  const binc = (bb - qsqz) / wincr;
  let bub = blb + binc;
  let einsum = 0;
  const cc1 = cc - 1;

  for (let wi = 1; wi <= wincr; wi++) {
    let elsum = 0;
    const a = 0.5 * (bub + blb);
    const b = 0.5 * (bub - blb);
    for (let jj = 1; jj <= nleg; jj++) {
      let j: number;
      let xx: number;
      if (ihalf < jj) {
        j = nleg - jj + 1;
        xx = XLEG[j - 1];
      } else {
        j = jj;
        xx = -XLEG[j - 1];
      }
      const ac = a + b * xx;
      const qexpo = ac * ac;
      if (qexpo > C3) break;
      const pplus = 2 * pnorm(ac);
      const pminus = 2 * pnorm(ac, w, 1);
      let rinsum = pplus * 0.5 - pminus * 0.5;
      if (rinsum >= Math.exp(C1 / cc1)) {
        rinsum = ALEG[j - 1] * Math.exp(-(0.5 * qexpo)) * Math.pow(rinsum, cc1);
        elsum += rinsum;
      }
    }
    elsum *= (2 * b * cc) / Math.sqrt(2 * Math.PI);
    einsum += elsum;
    blb = bub;
    bub += binc;
  }

  prW += einsum;
  if (prW <= Math.exp(C1 / rr)) return 0;
  prW = Math.pow(prW, rr);
  return prW >= 1 ? 1 : prW;
}

const XLEGQ = [
  0.98940093499164993259615417345, 0.944575023073232576077988415535,
  0.865631202387831743880467897712, 0.755404408355003033895101194847,
  0.617876244402643748446671764049, 0.458016777657227386342419442984,
  0.28160355077925891323046050146, 0.095012509837637440185319335425,
];
const ALEGQ = [
  0.027152459411754094851780572456, 0.062253523938647892862843836994,
  0.095158511682492784809925107602, 0.124628971255533872052476282192,
  0.149595988816576732081501730547, 0.16915651939500253818931207903,
  0.182603415044923588866763667969, 0.189450610455068496285396723208,
];

/** CDF of the studentized range P(Q < q) for cc means and df degrees of freedom. */
export function ptukey(q: number, cc: number, df: number, rr = 1): number {
  if (q <= 0) return 0;
  if (df < 2 || rr < 1 || cc < 2) return NaN;
  if (!Number.isFinite(q)) return 1;
  if (df > 25000) return wprob(q, rr, cc);

  const nlegq = 16;
  const ihalfq = 8;
  const eps1 = -30;
  const eps2 = 1e-14;

  const f2 = df * 0.5;
  let f2lf = f2 * Math.log(df) - df * Math.LN2 - lgamma(f2);
  const f21 = f2 - 1;
  const ff4 = df * 0.25;
  const ulen = df <= 100 ? 1 : df <= 800 ? 0.5 : df <= 5000 ? 0.25 : 0.125;
  f2lf += Math.log(ulen);

  let ans = 0;
  for (let i = 1; i <= 50; i++) {
    let otsum = 0;
    const twa1 = (2 * i - 1) * ulen;
    for (let jj = 1; jj <= nlegq; jj++) {
      let j: number;
      let t1: number;
      if (ihalfq < jj) {
        j = jj - ihalfq - 1;
        t1 = f2lf + f21 * Math.log(twa1 + XLEGQ[j] * ulen) - (XLEGQ[j] * ulen + twa1) * ff4;
      } else {
        j = jj - 1;
        t1 = f2lf + f21 * Math.log(twa1 - XLEGQ[j] * ulen) + (XLEGQ[j] * ulen - twa1) * ff4;
      }
      if (t1 >= eps1) {
        const qsqz =
          ihalfq < jj
            ? q * Math.sqrt((XLEGQ[j] * ulen + twa1) * 0.5)
            : q * Math.sqrt((-(XLEGQ[j] * ulen) + twa1) * 0.5);
        otsum += wprob(qsqz, rr, cc) * ALEGQ[j] * Math.exp(t1);
      }
    }
    if (i * ulen >= 1 && otsum <= eps2) break;
    ans += otsum;
  }
  return ans > 1 ? 1 : ans;
}

const qtukeyCache = new Map<string, number>();

/** Quantile of the studentized range distribution. */
export function qtukey(p: number, cc: number, df: number): number {
  const key = `${p}|${cc}|${df}`;
  const hit = qtukeyCache.get(key);
  if (hit !== undefined) return hit;
  const v = bisect((x) => ptukey(x, cc, df) - p, 0, 10, 1e-9);
  qtukeyCache.set(key, v);
  return v;
}

// ---------------------------------------------------------------------------
// Dunnett many-to-one comparisons (two-sided)
// ---------------------------------------------------------------------------

/**
 * P(max_i |T_i| <= c) for Dunnett statistics with correlation
 * rho_ij = lambda_i * lambda_j, lambda_i = sqrt(n_i / (n_i + n_0)).
 * Integrates the one-factor representation of the multivariate t over the
 * normal factor and the chi scale with composite Simpson rules.
 */
export function pdunnett(c: number, lambdas: number[], df: number): number {
  if (c <= 0) return 0;
  const k = lambdas.length;
  const sq = lambdas.map((l) => Math.sqrt(1 - l * l));
  const SQRT2PI = Math.sqrt(2 * Math.PI);

  const inner = (cs: number): number => {
    const nW = 160;
    const lo = -8;
    const h = 16 / nW;
    let sum = 0;
    for (let i = 0; i <= nW; i++) {
      const w = lo + i * h;
      let prod = Math.exp(-0.5 * w * w) / SQRT2PI;
      for (let j = 0; j < k && prod > 0; j++) {
        const lw = lambdas[j] * w;
        prod *= pnorm((cs - lw) / sq[j]) - pnorm((-cs - lw) / sq[j]);
      }
      const wt = i === 0 || i === nW ? 1 : i % 2 === 1 ? 4 : 2;
      sum += wt * prod;
    }
    return (sum * h) / 3;
  };

  if (!Number.isFinite(df) || df > 1e5) return inner(c);

  // Density of S = sqrt(chi2_df / df)
  const logConst = (df / 2) * Math.log(df) - lgamma(df / 2) - (df / 2 - 1) * Math.LN2;
  const dens = (s: number) =>
    s <= 0 ? 0 : Math.exp(logConst + (df - 1) * Math.log(s) - (df * s * s) / 2);

  const sMax = Math.sqrt((df + 40 + 12 * Math.sqrt(df)) / df) + 2;
  const nS = 240;
  const h = sMax / nS;
  let sum = 0;
  for (let i = 0; i <= nS; i++) {
    const s = i * h;
    const d = dens(s);
    const wt = i === 0 || i === nS ? 1 : i % 2 === 1 ? 4 : 2;
    if (d > 1e-300) sum += wt * d * inner(c * s);
  }
  return Math.min(1, (sum * h) / 3);
}

const qdunnettCache = new Map<string, number>();

export function qdunnett(p: number, lambdas: number[], df: number): number {
  const key = `${p}|${lambdas.map((l) => l.toFixed(10)).join(',')}|${df}`;
  const hit = qdunnettCache.get(key);
  if (hit !== undefined) return hit;
  const v = bisect((x) => pdunnett(x, lambdas, df) - p, 0, 10, 1e-7);
  qdunnettCache.set(key, v);
  return v;
}
