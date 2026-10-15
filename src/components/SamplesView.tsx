import { useMemo } from 'react';
import type { Well } from '../lib/parse/quantstudio';
import { autoDesign, type Design } from '../lib/analysis/design';

interface Props {
  design: Design;
  setDesign: (d: Design) => void;
  wells: Well[];
}

export function SamplesView({ design, setDesign, wells }: Props) {
  const byCond = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const s of design.samples) m.set(s.condition, [...(m.get(s.condition) ?? []), s.sample]);
    return m;
  }, [design.samples]);
  const hasPanels = new Set(design.conditions.map((c) => c.panel)).size > 1;

  const setCond = (name: string, p: Partial<Design['conditions'][number]>) =>
    setDesign({ ...design, conditions: design.conditions.map((c) => (c.name === name ? { ...c, ...p } : c)) });
  const setSample = (sample: string, p: Partial<Design['samples'][number]>) => {
    const samples = design.samples.map((s) => (s.sample === sample ? { ...s, ...p } : s));
    // a sample moved to a new condition name creates that condition
    const conditions = [...design.conditions];
    for (const s of samples) {
      if (!conditions.some((c) => c.name === s.condition)) conditions.push({ name: s.condition, panel: '', group: s.condition, include: true });
    }
    setDesign({ samples, conditions: conditions.filter((c) => samples.some((s) => s.condition === c.name)) });
  };

  const ntc = [...new Set(wells.filter((w) => w.task === 'NTC').map((w) => w.sample))];

  return (
    <div className="samples">
      <div className="card">
        <header className="card-head">
          <h2>Conditions</h2>
          <span className="muted small">Sample names are split into condition + replicate number (e.g. “chKO2” → “chKO”, replicate 2).</span>
          <div className="spacer" />
          <button className="btn tiny ghost" onClick={() => setDesign(autoDesign(wells))}>Re-detect</button>
          <button
            className="btn tiny ghost"
            onClick={() => setDesign({ ...design, conditions: design.conditions.map((c) => ({ ...c, panel: '', group: c.name })) })}
          >
            One panel
          </button>
          {hasPanels && (
            <button
              className="btn tiny ghost"
              title="Use the panel as comparison group and vice versa, e.g. to compare lineages within each genotype"
              onClick={() => setDesign({ ...design, conditions: design.conditions.map((c) => ({ ...c, panel: c.group, group: c.panel || '(no prefix)' })) })}
            >
              Swap panel ↔ group
            </button>
          )}
        </header>
        <p className="note">
          <strong>Group</strong> = what is compared (e.g. WT vs KO). <strong>Panel</strong> (optional) splits the analysis, e.g. by cell
          lineage: RQ reference and statistics are computed within each panel. Give conditions the same group name to pool them.
        </p>
        <table className="data editable">
          <thead>
            <tr>
              <th>Include</th>
              <th>Condition</th>
              <th>Panel</th>
              <th>Group</th>
              <th>Samples</th>
            </tr>
          </thead>
          <tbody>
            {design.conditions.map((c) => (
              <tr key={c.name} className={c.include ? '' : 'excluded'}>
                <td>
                  <input type="checkbox" checked={c.include} onChange={(e) => setCond(c.name, { include: e.target.checked })} />
                </td>
                <td className="strong">{c.name}</td>
                <td>
                  <input value={c.panel} placeholder="(none)" onChange={(e) => setCond(c.name, { panel: e.target.value })} />
                </td>
                <td>
                  <input value={c.group} onChange={(e) => setCond(c.name, { group: e.target.value })} />
                </td>
                <td className="muted small">{(byCond.get(c.name) ?? []).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <header className="card-head">
          <h2>Samples</h2>
          <span className="muted small">Replicate numbers are used to match pairs in a paired design.</span>
        </header>
        <table className="data editable">
          <thead>
            <tr>
              <th>Include</th>
              <th>Sample</th>
              <th>Condition</th>
              <th>Biological replicate</th>
            </tr>
          </thead>
          <tbody>
            {design.samples.map((s) => (
              <tr key={s.sample} className={s.include ? '' : 'excluded'}>
                <td>
                  <input type="checkbox" checked={s.include} onChange={(e) => setSample(s.sample, { include: e.target.checked })} />
                </td>
                <td className="strong">{s.sample}</td>
                <td>
                  <input value={s.condition} onChange={(e) => setSample(s.sample, { condition: e.target.value })} />
                </td>
                <td>
                  <input className="short" value={s.biorep} onChange={(e) => setSample(s.sample, { biorep: e.target.value })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {ntc.length > 0 && <p className="note">No-template controls (task NTC) are not analysed: {ntc.join(', ')}. See “Quality control”.</p>}
        <p className="note">
          Excluding a biological replicate needs a documented reason that is independent of the result (e.g. failed RNA quality,
          known handling error). Do not exclude replicates only because they weaken an effect.
        </p>
      </div>
    </div>
  );
}