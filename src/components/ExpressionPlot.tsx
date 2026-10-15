import { forwardRef } from 'react';
import type { Comparison, GroupSummary, OutputScale, PanelStats } from '../lib/analysis/types';
import { isRatioScale, pointValue, SCALE_LABEL, summaryValue } from '../lib/analysis/scale';
import { panelLabel } from '../lib/analysis/design';
import { fmtP, stars } from '../lib/format';

export interface PlotStyle {
  kind: 'bar' | 'dot';
  logAxis: boolean;
  showPoints: boolean;
  sig: 'stars' | 'p' | 'none';
  showNs: boolean;
  widthMm: number;
  heightMm: number;
  fontPt: number;
  palette: 'color' | 'grey';
  italicTitle: boolean;
}

export const DEFAULT_PLOT_STYLE: PlotStyle = {
  kind: 'bar',
  logAxis: false,
  showPoints: true,
  sig: 'stars',
  showNs: true,
  widthMm: 85,
  heightMm: 65,
  fontPt: 8,
  palette: 'color',
  italicTitle: true,
};

// Okabe-Ito colour-blind safe palette
const COLORS = ['#0072B2', '#D55E00', '#009E73', '#CC79A7', '#E69F00', '#56B4E9', '#F0E442', '#000000'];
const GREYS = ['#555555', '#8c8c8c', '#b5b5b5', '#2b2b2b', '#d6d6d6', '#707070'];
const REF_FILL = { color: '#D9D9D9', grey: '#ffffff' };

const MM = 2.8346; // pt per mm

interface Props {
  target: string;
  summaries: GroupSummary[];
  stats: PanelStats[];
  panels: string[];
  groupsByPanel: Record<string, string[]>;
  allGroups: string[];
  referenceGroup: string;
  scale: OutputScale;
  alpha: number;
  comparisonsMode: 'vsReference' | 'allPairs';
  style: PlotStyle;
}

function niceStep(range: number, count: number) {
  const raw = range / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return step * mag;
}

function linearTicks(min: number, max: number, count = 5) {
  const step = niceStep(max - min || 1, count);
  const start = Math.ceil(min / step - 1e-9) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

function tickLabel(v: number) {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1000 || a < 0.01) return v.toExponential(0).replace('e+', 'e');
  return String(Number(v.toPrecision(4)));
}

const textWidth = (s: string, font: number) => s.length * font * 0.56;

export const ExpressionPlot = forwardRef<SVGSVGElement, Props>(function ExpressionPlot(p, ref) {
  const { style, scale } = p;
  const font = style.fontPt;
  const W = style.widthMm * MM;
  const H = style.heightMm * MM;
  const hasPanels = p.panels.length > 1;
  const ratio = isRatioScale(scale);
  const logAxis = ratio && style.logAxis;
  const tf = (v: number) => (logAxis ? Math.log2(v) : v);

  // Slots
  type Slot = { panel: string; group: string; s: GroupSummary };
  const slots: Slot[] = [];
  const panelSlots: { panel: string; from: number; to: number }[] = [];
  for (const panel of p.panels) {
    const from = slots.length;
    for (const g of p.groupsByPanel[panel] ?? []) {
      const s = p.summaries.find((x) => x.panel === panel && x.group === g);
      if (s) slots.push({ panel, group: g, s });
    }
    if (slots.length > from) panelSlots.push({ panel, from, to: slots.length - 1 });
  }
  if (slots.length === 0) {
    return (
      <svg ref={ref} width={`${style.widthMm}mm`} height={`${style.heightMm}mm`} viewBox={`0 0 ${W} ${H}`}>
        <text x={W / 2} y={H / 2} textAnchor="middle" fontSize={font} fontFamily="Arial, Helvetica, sans-serif">
          No data
        </text>
      </svg>
    );
  }

  // Comparisons to annotate
  type Br = { c: Comparison; x1: number; x2: number; level: number; label: string };
  const brackets: Br[] = [];
  const slotIndex = (panel: string, g: string) => slots.findIndex((x) => x.panel === panel && x.group === g);
  if (style.sig !== 'none') {
    for (const st of p.stats) {
      const comps = st.comparisons
        .map((c) => ({ c, i: slotIndex(st.panel, c.group1), j: slotIndex(st.panel, c.group2) }))
        .filter((x) => x.i >= 0 && x.j >= 0)
        .filter((x) => style.showNs || x.c.pFinal < p.alpha)
        .filter((x) => p.comparisonsMode === 'vsReference' || x.c.pFinal < p.alpha || style.showNs)
        .sort((a, b) => Math.abs(a.i - a.j) - Math.abs(b.i - b.j));
      const levels: [number, number][][] = [];
      for (const x of comps) {
        const lo = Math.min(x.i, x.j);
        const hi = Math.max(x.i, x.j);
        let level = 0;
        while ((levels[level] ?? []).some(([a, b]) => !(hi < a || lo > b))) level++;
        (levels[level] ??= []).push([lo, hi]);
        brackets.push({
          c: x.c,
          x1: lo,
          x2: hi,
          level,
          label: style.sig === 'stars' ? stars(x.c.pFinal, p.alpha) : `p ${fmtP(x.c.pFinal).startsWith('<') ? fmtP(x.c.pFinal) : '= ' + fmtP(x.c.pFinal)}`,
        });
      }
    }
  }
  const nLevels = brackets.length ? Math.max(...brackets.map((b) => b.level)) + 1 : 0;
  const bracketStep = font * 1.45;

  // Data range
  const vals: number[] = [];
  for (const sl of slots) {
    const v = summaryValue(sl.s, scale);
    vals.push(v.mid, v.low, v.high);
    if (style.showPoints) for (const b of sl.s.values) {
      const pv = pointValue(b, scale);
      if (pv !== null && Number.isFinite(pv)) vals.push(pv);
    }
  }
  const tv = vals.filter((v) => Number.isFinite(v) && (!logAxis || v > 0)).map(tf);
  let yMin: number;
  let yMax: number;
  if (logAxis) {
    yMin = Math.min(0, Math.floor(Math.min(...tv)));
    yMax = Math.max(0, Math.ceil(Math.max(...tv)));
    if (yMax === yMin) yMax = yMin + 1;
  } else {
    yMin = Math.min(0, ...tv);
    yMax = Math.max(0, ...tv);
    const pad = (yMax - yMin || 1) * 0.06;
    if (yMin < 0) yMin -= pad;
    yMax += pad;
  }

  // Ticks
  let ticks: number[];
  if (logAxis) {
    const span = yMax - yMin;
    const step = span > 8 ? 2 : 1;
    ticks = [];
    for (let e = Math.ceil(yMin / step) * step; e <= yMax; e += step) ticks.push(e);
  } else {
    ticks = linearTicks(yMin, yMax);
    yMax = Math.max(yMax, ticks[ticks.length - 1]);
    yMin = Math.min(yMin, ticks[0]);
  }
  const tickText = (t: number) => (logAxis ? tickLabel(Math.pow(2, t)) : tickLabel(t));
  const maxTickW = Math.max(...ticks.map((t) => textWidth(tickText(t), font)));

  // Margins
  const titleH = font * 1.9;
  const left = maxTickW + font * 2.6;
  const right = font * 0.8;
  const top = titleH + nLevels * bracketStep + (nLevels ? font * 0.4 : 0);
  const plotW = W - left - right;
  const gap = 0.55;
  const nUnits = slots.length + gap * (panelSlots.length - 1);
  const unit = plotW / nUnits;
  const xCenter = (i: number) => {
    const panelIdx = panelSlots.findIndex((ps) => i >= ps.from && i <= ps.to);
    return left + (i + 0.5 + panelIdx * gap) * unit;
  };
  const labelW = Math.max(...slots.map((s) => textWidth(s.group, font)));
  const rotate = labelW > unit * 0.95;
  const labelH = rotate ? labelW * 0.72 + font : font * 1.5;
  const bottom = labelH + (hasPanels ? font * 1.9 : font * 0.3);
  const plotTop = top;
  const plotBottom = H - bottom;
  const y = (v: number) => plotBottom - ((v - yMin) / (yMax - yMin)) * (plotBottom - plotTop);
  const base = logAxis ? 0 : ratio ? 0 : 0;
  const bw = Math.min(unit * 0.64, font * 4.2);

  const allGroups = p.allGroups;
  const colorFor = (g: string) => {
    if (g === p.referenceGroup) return REF_FILL[style.palette];
    const others = allGroups.filter((x) => x !== p.referenceGroup);
    const i = Math.max(0, others.indexOf(g));
    return style.palette === 'grey' ? GREYS[i % GREYS.length] : COLORS[i % COLORS.length];
  };

  const stroke = '#1a1a1a';
  const lw = 0.75;
  const ff = 'Arial, Helvetica, sans-serif';

  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={`${style.widthMm}mm`}
      height={`${style.heightMm}mm`}
      viewBox={`0 0 ${W.toFixed(2)} ${H.toFixed(2)}`}
      fontFamily={ff}
      fontSize={font}
      className="plot-svg"
    >
      <rect x={0} y={0} width={W} height={H} fill="#ffffff" />
      <text x={left + plotW / 2} y={font * 1.25} textAnchor="middle" fontWeight="bold" fontStyle={style.italicTitle ? 'italic' : 'normal'} fontSize={font * 1.1}>
        {p.target}
      </text>

      {/* y axis */}
      <line x1={left} x2={left} y1={plotTop} y2={plotBottom} stroke={stroke} strokeWidth={lw} />
      {ticks.map((t) => (
        <g key={t}>
          <line x1={left - font * 0.35} x2={left} y1={y(t)} y2={y(t)} stroke={stroke} strokeWidth={lw} />
          <text x={left - font * 0.55} y={y(t) + font * 0.35} textAnchor="end">
            {tickText(t)}
          </text>
        </g>
      ))}
      <text
        transform={`translate(${font * 1.0},${(plotTop + plotBottom) / 2}) rotate(-90)`}
        textAnchor="middle"
      >
        {SCALE_LABEL[scale]}
        {logAxis ? ' (log2 axis)' : ''}
      </text>

      {/* baseline */}
      <line x1={left} x2={left + plotW} y1={y(Math.max(yMin, Math.min(yMax, base)))} y2={y(Math.max(yMin, Math.min(yMax, base)))} stroke={stroke} strokeWidth={lw} />
      {ratio && !logAxis && yMax > 1 && (
        <line x1={left} x2={left + plotW} y1={y(1)} y2={y(1)} stroke="#9a9a9a" strokeWidth={0.5} strokeDasharray="2 2" />
      )}

      {slots.map((sl, i) => {
        const cx = xCenter(i);
        const v = summaryValue(sl.s, scale);
        const fill = colorFor(sl.group);
        const mid = tf(v.mid);
        const lo = tf(v.low);
        const hi = tf(v.high);
        const pts = style.showPoints
          ? sl.s.values.map((b) => pointValue(b, scale)).filter((x): x is number => x !== null && Number.isFinite(x) && (!logAxis || x > 0))
          : [];
        const n = pts.length;
        const spread = Math.min(bw * 0.62, font * 0.75 * n);
        const r = font * 0.27;
        return (
          <g key={`${sl.panel}|${sl.group}`}>
            {style.kind === 'bar' && Number.isFinite(mid) && (
              <rect
                x={cx - bw / 2}
                y={Math.min(y(mid), y(base))}
                width={bw}
                height={Math.abs(y(mid) - y(base))}
                fill={fill}
                stroke={stroke}
                strokeWidth={lw}
              />
            )}
            {sl.s.n >= 2 && Number.isFinite(lo) && Number.isFinite(hi) && (
              <g stroke={stroke} strokeWidth={lw}>
                <line x1={cx} x2={cx} y1={y(lo)} y2={y(hi)} />
                <line x1={cx - bw * 0.18} x2={cx + bw * 0.18} y1={y(hi)} y2={y(hi)} />
                <line x1={cx - bw * 0.18} x2={cx + bw * 0.18} y1={y(lo)} y2={y(lo)} />
              </g>
            )}
            {style.kind === 'dot' && Number.isFinite(mid) && (
              <line x1={cx - bw * 0.36} x2={cx + bw * 0.36} y1={y(mid)} y2={y(mid)} stroke={stroke} strokeWidth={lw * 1.6} />
            )}
            {pts.map((pv, k) => (
              <circle
                key={k}
                cx={cx + (n > 1 ? (k / (n - 1) - 0.5) * spread : 0)}
                cy={y(tf(pv))}
                r={r}
                fill={style.kind === 'bar' ? '#ffffff' : fill === '#ffffff' ? '#ffffff' : fill}
                stroke={stroke}
                strokeWidth={lw * 0.8}
              />
            ))}
            {/* group label */}
            {rotate ? (
              <text transform={`translate(${cx + font * 0.3},${plotBottom + font * 0.9}) rotate(-45)`} textAnchor="end">
                {sl.group}
              </text>
            ) : (
              <text x={cx} y={plotBottom + font * 1.2} textAnchor="middle">
                {sl.group}
              </text>
            )}
          </g>
        );
      })}

      {/* panel labels */}
      {hasPanels &&
        panelSlots.map((ps) => {
          const x1 = xCenter(ps.from) - bw / 2;
          const x2 = xCenter(ps.to) + bw / 2;
          const yy = plotBottom + labelH + font * 0.25;
          return (
            <g key={ps.panel}>
              <line x1={x1} x2={x2} y1={yy} y2={yy} stroke={stroke} strokeWidth={0.5} />
              <text x={(x1 + x2) / 2} y={yy + font * 1.1} textAnchor="middle">
                {panelLabel(ps.panel, true)}
              </text>
            </g>
          );
        })}

      {/* significance brackets */}
      {brackets.map((b, k) => {
        const x1 = xCenter(b.x1);
        const x2 = xCenter(b.x2);
        const yy = plotTop - font * 0.5 - b.level * bracketStep;
        const tick = font * 0.35;
        return (
          <g key={k}>
            <path d={`M${x1},${yy + tick} V${yy} H${x2} V${yy + tick}`} fill="none" stroke={stroke} strokeWidth={lw * 0.8} />
            <text x={(x1 + x2) / 2} y={yy - font * 0.25} textAnchor="middle" fontSize={b.label === 'ns' ? font * 0.85 : font}>
              {b.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
});