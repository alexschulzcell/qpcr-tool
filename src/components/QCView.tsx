import { Fragment, useMemo, useState } from 'react';
import type { ParsedFile, Well } from '../lib/parse/quantstudio';
import type { AnalysisResult, Settings, WellResult, WellStatus } from '../lib/analysis/types';
import { panelLabel } from '../lib/analysis/design';
import { fmt, fmtP } from '../lib/format';

interface Props {
  files: ParsedFile[];
  result: AnalysisResult;
  settings: Settings;
  toggleWell: (id: string) => void;
  patch: (p: Partial<Settings>) => void;
}

const STATUS_LABEL: Record<WellStatus, string> = {
  used: 'used',
  nd: 'not detected',
  'nd-sample': 'sample not detected',
  outlier: 'technical outlier',
  manual: 'excluded manually',
  omitted: 'omitted (instrument)',
};

function ctColor(ct: number) {
  // light (low expression / high Ct) to dark (high expression / low Ct)
  const t = Math.max(0, Math.min(1, (ct - 14) / (40 - 14)));
  const l = 28 + t * 62;
  return `hsl(205 60% ${l}%)`;
}

function WellChip({ w, onClick }: { w: WellResult; onClick: () => void }) {
  const ct = w.well.ct;
  return (
    <button
      className={`well-chip st-${w.status}`}
      title={`${w.well.fileName} ${w.well.position}\n${STATUS_LABEL[w.status]}${w.reason ? `: ${w.reason}` : ''}${w.well.flags.length ? `\nInstrument flags: ${w.well.flags.join(', ')}` : ''}\nClick to ${w.status === 'manual' ? 'include again' : 'exclude'}`}
      onClick={onClick}
    >
      {ct === null ? (w.well.undetermined ? 'Undet.' : '–') : ct.toFixed(2)}
    </button>
  );
}

export function QCView({ files, result, settings, toggleWell, patch }: Props) {
  const genes = [...settings.hkGenes, ...settings.targetGenes];
  const [gene, setGene] = useState(genes[0] ?? '');
  const [plateFile, setPlateFile] = useState(0);
  const [plateGene, setPlateGene] = useState('');

  const statusById = useMemo(() => {
    const m = new Map<string, WellResult>();
    for (const st of result.sampleTargets) for (const w of st.wells) m.set(w.well.id, w);
    return m;
  }, [result]);

  const counts = useMemo(() => {
    const c: Record<WellStatus, number> = { used: 0, nd: 0, 'nd-sample': 0, outlier: 0, manual: 0, omitted: 0 };
    for (const st of result.sampleTargets) for (const w of st.wells) c[w.status]++;
    return c;
  }, [result]);
  const flagged = result.sampleTargets.flatMap((x) => x.wells).filter((w) => w.well.flags.length > 0).length;

  const ntc = files.flatMap((f) => f.wells).filter((w) => w.task === 'NTC');
  const ntcHits = ntc.filter((w) => w.ct !== null && w.ct <= settings.ctCutoff);

  const rows = result.sampleTargets.filter((x) => x.target === gene);
  const hasPanels = result.panels.length > 1;
  const file = files[plateFile] ?? files[0];
  const nRows = file.plateFormat === 384 ? 16 : 8;
  const nCols = file.plateFormat === 384 ? 24 : 12;
  const grid = useMemo(() => {
    const g: (Well | undefined)[][] = Array.from({ length: nRows }, () => Array(nCols).fill(undefined));
    for (const w of file.wells) if (w.row >= 0 && w.row < nRows && w.col >= 0 && w.col < nCols) g[w.row][w.col] = w;
    return g;
  }, [file, nRows, nCols]);

  return (
    <div className="qc">
      <div className="card">
        <header className="card-head">
          <h2>Overview</h2>
        </header>
        <div className="kpis">
          <div className="kpi"><span>{counts.used}</span>wells used</div>
          <div className="kpi"><span>{counts.nd + counts['nd-sample']}</span>not detected</div>
          <div className="kpi"><span>{counts.outlier}</span>technical outliers</div>
          <div className="kpi"><span>{counts.manual}</span>excluded manually</div>
          <div className="kpi"><span>{counts.omitted}</span>omitted in software</div>
          <div className="kpi"><span>{flagged}</span>with instrument QC flags</div>
        </div>
        {settings.manualExcluded.length > 0 && (
          <button className="btn tiny ghost" onClick={() => patch({ manualExcluded: [] })}>
            Undo all manual exclusions
          </button>
        )}
        {ntc.length > 0 && (
          <p className={ntcHits.length ? 'note warn' : 'note'}>
            No-template controls: {ntc.length} wells,{' '}
            {ntcHits.length
              ? `${ntcHits.length} amplified (${ntcHits.map((w) => `${w.target} Ct ${w.ct!.toFixed(1)}`).join(', ')}) — check for contamination / primer dimers.`
              : 'none amplified.'}
          </p>
        )}
      </div>

      <div className="card">
        <header className="card-head">
          <h2>Technical replicates</h2>
          <select value={gene} onChange={(e) => setGene(e.target.value)}>
            {genes.map((g) => (
              <option key={g} value={g}>
                {g}
                {settings.hkGenes.includes(g) ? ' (reference)' : ''}
              </option>
            ))}
          </select>
          <span className="muted small">Click a Ct value to exclude or re-include that well.</span>
        </header>
        <div className="legend">
          {(['used', 'outlier', 'nd', 'nd-sample', 'manual', 'omitted'] as WellStatus[]).map((s) => (
            <span key={s} className={`well-chip st-${s} static`}>{STATUS_LABEL[s]}</span>
          ))}
        </div>
        <table className="data">
          <thead>
            <tr>
              <th>Sample</th>
              <th>Ct values</th>
              <th>Mean Ct</th>
              <th>SD</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.sample} className={r.highSd ? 'row-warn' : ''}>
                <td className="strong">{r.sample}</td>
                <td className="chips">
                  {r.wells.map((w) => (
                    <WellChip key={w.well.id} w={w} onClick={() => toggleWell(w.well.id)} />
                  ))}
                </td>
                <td className="num">{fmt(r.meanCt, 2)}</td>
                <td className={r.highSd ? 'num warn-text' : 'num'}>{fmt(r.sdCt, 3)}</td>
                <td className="muted small">
                  {[
                    !r.detected && 'not detected',
                    r.lowConfidence && `Ct > ${settings.lowConfidenceCt}`,
                    r.highSd && `SD > ${settings.highSdWarn}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <header className="card-head">
          <h2>Reference gene stability</h2>
          <span className="muted small">The reference gene should not differ systematically between groups.</span>
        </header>
        <table className="data">
          <thead>
            <tr>
              <th>Gene</th>
              {hasPanels && <th>Panel</th>}
              {Array.from(new Set(result.hkStability.flatMap((h) => h.groups.map((g) => g.group)))).map((g) => (
                <th key={g}>{g}</th>
              ))}
              <th>Range</th>
              <th>p (Welch)</th>
            </tr>
          </thead>
          <tbody>
            {result.hkStability.map((h) => {
              const allG = Array.from(new Set(result.hkStability.flatMap((x) => x.groups.map((g) => g.group))));
              return (
                <tr key={h.gene + h.panel} className={h.warn ? 'row-warn' : ''}>
                  <td className="strong">{h.gene}</td>
                  {hasPanels && <td>{panelLabel(h.panel, true)}</td>}
                  {allG.map((g) => {
                    const x = h.groups.find((y) => y.group === g);
                    return (
                      <td key={g} className="num">
                        {x && x.n ? `${fmt(x.meanCt, 2)} ± ${fmt(x.sdCt, 2)}` : ''}
                      </td>
                    );
                  })}
                  <td className={h.range > 1 ? 'num warn-text' : 'num'}>{fmt(h.range, 2)}</td>
                  <td className={h.p !== null && h.p < 0.05 ? 'num warn-text' : 'num'}>{fmtP(h.p)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="note">
          Warning when group means differ by more than 1 cycle or significantly (p &lt; 0.05). Consider a second reference gene in that case.
        </p>
      </div>

      <div className="card">
        <header className="card-head">
          <h2>Plate</h2>
          {files.length > 1 && (
            <select value={plateFile} onChange={(e) => setPlateFile(Number(e.target.value))}>
              {files.map((f, i) => (
                <option key={i} value={i}>{f.name}</option>
              ))}
            </select>
          )}
          <select value={plateGene} onChange={(e) => setPlateGene(e.target.value)}>
            <option value="">all targets</option>
            {[...new Set(file.wells.map((w) => w.target))].map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
          <span className="muted small">Colour = Ct (dark = low Ct). Hover for details, click to exclude.</span>
        </header>
        <div className="plate" style={{ gridTemplateColumns: `1.6em repeat(${nCols}, 1fr)` }}>
          <span />
          {Array.from({ length: nCols }, (_, c) => (
            <span key={c} className="plate-label">{c + 1}</span>
          ))}
          {grid.map((row, r) => (
            <Fragment key={r}>
              <span className="plate-label">{String.fromCharCode(65 + r)}</span>
              {row.map((w, c) => {
                if (!w) return <span key={`${r}-${c}`} className="pw empty" />;
                const st = statusById.get(w.id);
                const dim = plateGene && w.target !== plateGene;
                const status = st?.status;
                const bg = w.ct !== null && status !== 'nd' ? ctColor(w.ct) : '#ffffff';
                return (
                  <button
                    key={`${r}-${c}`}
                    className={`pw ${status ? 'st-' + status : 'unused'} ${dim ? 'dim' : ''} ${w.task === 'NTC' ? 'ntc' : ''}`}
                    style={{ background: bg }}
                    title={`${w.position}: ${w.sample} · ${w.target}\nCt ${w.ct === null ? w.ctRaw || '–' : w.ct.toFixed(2)}${status ? `\n${STATUS_LABEL[status]}${st?.reason ? ': ' + st.reason : ''}` : '\nnot in analysis'}${w.flags.length ? '\nflags: ' + w.flags.join(', ') : ''}`}
                    onClick={() => st && toggleWell(w.id)}
                  />
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}