import { useRef, useState } from 'react';
import type { AnalysisResult, Settings } from '../lib/analysis/types';
import { panelLabel } from '../lib/analysis/design';
import { isRatioScale, SCALE_SHORT, summaryValue } from '../lib/analysis/scale';
import { fmt, fmtFC, fmtP, sanitizeFileName, stars } from '../lib/format';
import { downloadPng, downloadSvg } from '../lib/download';
import { ExpressionPlot, type PlotStyle } from './ExpressionPlot';

interface Props {
  result: AnalysisResult;
  settings: Settings;
  style: PlotStyle;
  setStyle: (s: PlotStyle) => void;
}

function StyleBar({ style, setStyle, ratio }: { style: PlotStyle; setStyle: (s: PlotStyle) => void; ratio: boolean }) {
  const set = (p: Partial<PlotStyle>) => setStyle({ ...style, ...p });
  return (
    <div className="stylebar">
      <div className="seg">
        <button className={style.kind === 'bar' ? 'on' : ''} onClick={() => set({ kind: 'bar' })}>Bars</button>
        <button className={style.kind === 'dot' ? 'on' : ''} onClick={() => set({ kind: 'dot' })}>Mean + dots</button>
      </div>
      {ratio && (
        <label className="check inline">
          <input type="checkbox" checked={style.logAxis} onChange={(e) => set({ logAxis: e.target.checked })} /> log2 axis
        </label>
      )}
      <label className="check inline">
        <input type="checkbox" checked={style.showPoints} onChange={(e) => set({ showPoints: e.target.checked })} /> replicates
      </label>
      <label className="inline-field">
        Labels
        <select value={style.sig} onChange={(e) => set({ sig: e.target.value as PlotStyle['sig'] })}>
          <option value="stars">stars</option>
          <option value="p">p-values</option>
          <option value="none">none</option>
        </select>
      </label>
      <label className="check inline">
        <input type="checkbox" checked={style.showNs} onChange={(e) => set({ showNs: e.target.checked })} /> show ns
      </label>
      <label className="inline-field">
        Size
        <input type="number" value={style.widthMm} min={30} max={300} onChange={(e) => set({ widthMm: Number(e.target.value) || 85 })} />×
        <input type="number" value={style.heightMm} min={30} max={300} onChange={(e) => set({ heightMm: Number(e.target.value) || 65 })} />mm
      </label>
      <label className="inline-field">
        Font
        <input type="number" value={style.fontPt} min={5} max={14} step={0.5} onChange={(e) => set({ fontPt: Number(e.target.value) || 8 })} />pt
      </label>
      <label className="inline-field">
        Colours
        <select value={style.palette} onChange={(e) => set({ palette: e.target.value as PlotStyle['palette'] })}>
          <option value="color">colour-blind safe</option>
          <option value="grey">greyscale</option>
        </select>
      </label>
      <div className="presets">
        <button className="btn tiny ghost" onClick={() => set({ widthMm: 85, heightMm: 65 })} title="Single journal column">1 col</button>
        <button className="btn tiny ghost" onClick={() => set({ widthMm: 120, heightMm: 75 })} title="1.5 journal columns">1.5 col</button>
        <button className="btn tiny ghost" onClick={() => set({ widthMm: 180, heightMm: 90 })} title="Full page width">2 col</button>
      </div>
    </div>
  );
}

function GeneCard({ target, result, settings, style }: { target: string; result: AnalysisResult; settings: Settings; style: PlotStyle }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [busy, setBusy] = useState(false);
  const hasPanels = result.panels.length > 1;
  const sums = result.summaries.filter((x) => x.target === target);
  const stats = result.stats.filter((x) => x.target === target);
  const bio = result.bioreps.filter((x) => x.target === target);
  const nd = bio.filter((b) => b.notDetected && !b.valid);
  const imputed = bio.filter((b) => b.imputed);
  const allGroups = [...new Set(result.panels.flatMap((p) => result.groupsByPanel[p]))];
  const sc = settings.outputScale;
  const base = sanitizeFileName(`${target}_${SCALE_SHORT[sc]}`);

  const png = async (dpi: number) => {
    if (!svgRef.current) return;
    setBusy(true);
    try {
      await downloadPng(svgRef.current, `${base}_${dpi}dpi.png`, style.widthMm, style.heightMm, dpi);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="card gene-card">
      <header className="card-head">
        <h2 className="gene-title">{target}</h2>
        <span className="muted small">{[...new Set(stats.map((x) => x.testName))].filter((x) => x !== 'none').join(' · ')}</span>
        <div className="spacer" />
        <button className="btn tiny" onClick={() => svgRef.current && downloadSvg(svgRef.current, `${base}.svg`)}>SVG</button>
        <button className="btn tiny" disabled={busy} onClick={() => png(300)}>PNG 300 dpi</button>
        <button className="btn tiny" disabled={busy} onClick={() => png(600)}>PNG 600 dpi</button>
      </header>
      <div className="gene-body">
        <div className="plot-wrap">
          <ExpressionPlot
            ref={svgRef}
            target={target}
            summaries={sums}
            stats={stats}
            panels={result.panels}
            groupsByPanel={result.groupsByPanel}
            allGroups={allGroups}
            referenceGroup={settings.referenceGroup}
            scale={sc}
            alpha={settings.alpha}
            comparisonsMode={settings.comparisons}
            style={style}
          />
        </div>
        <div className="gene-tables">
          <table className="data">
            <thead>
              <tr>
                {hasPanels && <th>Panel</th>}
                <th>Group</th>
                <th>n</th>
                <th>ΔCt ± SD</th>
                <th>{SCALE_SHORT[sc]}</th>
                <th>{settings.errorBar === 'ci95' ? '95% CI' : settings.errorBar.toUpperCase()} range</th>
              </tr>
            </thead>
            <tbody>
              {sums.map((g) => {
                const v = summaryValue(g, sc);
                return (
                  <tr key={g.panel + g.group} className={g.isReference ? 'ref-row' : ''}>
                    {hasPanels && <td>{panelLabel(g.panel, true)}</td>}
                    <td>{g.group}{g.isReference && <span className="tag">ref</span>}</td>
                    <td>{g.n}</td>
                    <td className="num">{fmt(g.meanDct, 2)} ± {fmt(g.sdDct, 2)}</td>
                    <td className="num strong">{isRatioScale(sc) ? fmtFC(v.mid) : fmt(v.mid, 2)}</td>
                    <td className="num muted">
                      {g.n >= 2 ? `${isRatioScale(sc) ? fmtFC(v.low) : fmt(v.low, 2)} – ${isRatioScale(sc) ? fmtFC(v.high) : fmt(v.high, 2)}` : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {stats.map((st) => (
            <div key={st.panel} className="stat-block">
              {(hasPanels || st.omnibus) && (
                <div className="stat-head">
                  {hasPanels && <strong>{panelLabel(st.panel, true)}</strong>}
                  {st.omnibus && (
                    <span className="muted small">
                      {st.omnibus.method}: F({fmt(st.omnibus.df1, 0)}, {fmt(st.omnibus.df2, Number.isInteger(st.omnibus.df2) ? 0 : 2)}) = {fmt(st.omnibus.statistic, 2)}, p = {fmtP(st.omnibus.p)}
                    </span>
                  )}
                </div>
              )}
              {st.comparisons.length > 0 && (
                <table className="data compact">
                  <thead>
                    <tr>
                      <th>Comparison</th>
                      <th title="Fold change of the second group relative to the first, with 95% CI">Fold change [95% CI]</th>
                      <th>p{st.comparisons.some((c) => c.pFinal !== c.p) ? ' (adj.)' : ''}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {st.comparisons.map((c) => (
                      <tr key={c.group1 + c.group2}>
                        <td>{c.group2} vs {c.group1}</td>
                        <td className="num">
                          {fmtFC(c.foldChange)} <span className="muted">[{fmtFC(c.fcLow)}, {fmtFC(c.fcHigh)}]</span>
                        </td>
                        <td className="num">{fmtP(c.pFinal)}</td>
                        <td className={c.pFinal < settings.alpha ? 'sig' : 'muted'}>{stars(c.pFinal, settings.alpha)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {st.notes.map((n) => (
                <p key={n} className="note">{n}</p>
              ))}
            </div>
          ))}
          {nd.length > 0 && (
            <p className="note warn">
              Not detected (excluded): {nd.map((b) => b.sample).join(', ')}
            </p>
          )}
          {imputed.length > 0 && (
            <p className="note warn">
              Ct set to cutoff ({settings.ctCutoff}) for: {imputed.map((b) => b.sample).join(', ')} — values are upper bounds of ΔCt / lower bounds of expression.
            </p>
          )}
        </div>
      </div>
    </article>
  );
}

export function ResultsView({ result, settings, style, setStyle }: Props) {
  if (settings.targetGenes.length === 0 || settings.hkGenes.length === 0) {
    return <div className="empty">Choose reference and target genes in the panel on the left.</div>;
  }
  return (
    <div className="results">
      {result.warnings.length > 0 && (
        <div className="alert warn">
          {result.warnings.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
      )}
      {result.hkStability.some((h) => h.warn) && (
        <div className="alert warn">
          Reference gene expression differs between groups ({result.hkStability.filter((h) => h.warn).map((h) => `${h.gene}${h.panel ? ' in ' + h.panel : ''}: range ${h.range.toFixed(2)} cycles${h.p !== null ? `, p = ${fmtP(h.p)}` : ''}`).join('; ')}). This can bias ΔΔCt results — see “Quality control”.
        </div>
      )}
      <StyleBar style={style} setStyle={setStyle} ratio={isRatioScale(settings.outputScale)} />
      {settings.targetGenes.map((t) => (
        <GeneCard key={t} target={t} result={result} settings={settings} style={style} />
      ))}
    </div>
  );
}