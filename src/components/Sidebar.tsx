import { useMemo, useState, type ReactNode } from 'react';
import type { ParsedFile } from '../lib/parse/quantstudio';
import type { Design } from '../lib/analysis/design';
import type { AnalysisResult, Settings } from '../lib/analysis/types';
import { recommend, resolveFamily, TEST_LABELS } from '../lib/analysis/statsRunner';

interface Props {
  files: ParsedFile[];
  design: Design;
  settings: Settings;
  patch: (p: Partial<Settings>) => void;
  result: AnalysisResult | null;
}

function Section({ title, children, defaultOpen = true, hint }: { title: string; children: ReactNode; defaultOpen?: boolean; hint?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="side-section">
      <button className="side-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>{title}</span>
        {hint && !open && <span className="side-hint">{hint}</span>}
        <span className={open ? 'chev open' : 'chev'}>›</span>
      </button>
      {open && <div className="side-body">{children}</div>}
    </section>
  );
}

function Num({ label, value, onChange, step = 1, min, max, help }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; help?: string }) {
  return (
    <label className="field" title={help}>
      <span>{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : ''}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
      />
    </label>
  );
}

function Select<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Sidebar({ files, design, settings: s, patch, result }: Props) {
  const [showEff, setShowEff] = useState(Object.keys(s.efficiencies).length > 0);
  const targets = useMemo(() => {
    const t: string[] = [];
    for (const f of files) for (const w of f.wells) if (w.target && w.task !== 'NTC' && !t.includes(w.target)) t.push(w.target);
    return t;
  }, [files]);
  const groups = useMemo(() => [...new Set(design.conditions.filter((c) => c.include).map((c) => c.group))], [design]);
  const hasPanels = (result?.panels.length ?? 0) > 1;

  const rec = useMemo(() => {
    if (!result) return null;
    const sizes = result.panels.map((p) =>
      result.groupsByPanel[p].map((g) => result.summaries.filter((x) => x.panel === p && x.group === g).reduce((a, x) => Math.max(a, x.n), 0)),
    );
    // pairable when every group of a panel has the same set of replicate ids
    const pairable = result.panels.some((p) => {
      const ids = result.groupsByPanel[p].map((g) =>
        [...new Set(design.samples.filter((x) => design.conditions.find((c) => c.name === x.condition && c.panel === p && c.group === g)).map((x) => x.biorep))].sort().join(','),
      );
      return ids.length >= 2 && ids.every((x) => x === ids[0] && x !== '');
    });
    return recommend(sizes, pairable, s.comparisons);
  }, [result, design, s.comparisons]);

  const family = resolveFamily(s.testFamily);
  const maxK = result ? Math.max(0, ...result.panels.map((p) => result.groupsByPanel[p].length)) : 0;

  const setRole = (gene: string, role: 'hk' | 'target' | 'none') => {
    const hk = s.hkGenes.filter((g) => g !== gene);
    const tg = s.targetGenes.filter((g) => g !== gene);
    if (role === 'hk') hk.push(gene);
    if (role === 'target') tg.push(gene);
    patch({ hkGenes: targets.filter((t) => hk.includes(t)), targetGenes: targets.filter((t) => tg.includes(t)) });
  };

  return (
    <aside className="sidebar">
      <Section title="Genes" hint={`${s.hkGenes.join(', ')} · ${s.targetGenes.length} targets`}>
        <table className="gene-table">
          <thead>
            <tr>
              <th>Gene</th>
              <th title="Housekeeping / reference gene">Ref.</th>
              <th>Target</th>
              {showEff && <th title="Amplification efficiency in % (from a standard curve)">Eff. %</th>}
            </tr>
          </thead>
          <tbody>
            {targets.map((g) => (
              <tr key={g}>
                <td className="gene-name">{g}</td>
                <td>
                  <input type="checkbox" checked={s.hkGenes.includes(g)} onChange={(e) => setRole(g, e.target.checked ? 'hk' : 'none')} />
                </td>
                <td>
                  <input type="checkbox" checked={s.targetGenes.includes(g)} onChange={(e) => setRole(g, e.target.checked ? 'target' : 'none')} />
                </td>
                {showEff && (
                  <td>
                    <input
                      className="eff"
                      type="number"
                      placeholder="100"
                      value={s.efficiencies[g] ?? ''}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        const eff = { ...s.efficiencies };
                        if (Number.isFinite(v) && v > 0) eff[g] = v;
                        else delete eff[g];
                        patch({ efficiencies: eff });
                      }}
                    />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {s.hkGenes.length > 1 && <p className="note">Multiple reference genes are combined by their mean Ct (= geometric mean of quantities).</p>}
        <label className="check">
          <input
            type="checkbox"
            checked={showEff}
            onChange={(e) => {
              setShowEff(e.target.checked);
              if (!e.target.checked) patch({ efficiencies: {} });
            }}
          />
          Efficiency correction (Pfaffl)
        </label>
      </Section>

      <Section title="Reference group (calibrator)" hint={s.referenceGroup}>
        <Select
          label="RQ = 1 for"
          value={s.referenceGroup}
          onChange={(v) => patch({ referenceGroup: v })}
          options={groups.map((g) => [g, g] as [string, string])}
        />
        {hasPanels && (
          <Select
            label="Reference mean"
            value={s.referenceScope}
            onChange={(v) => patch({ referenceScope: v })}
            options={[
              ['panel', 'within each panel'],
              ['pooled', 'pooled over all panels'],
            ]}
          />
        )}
        <p className="note">Panels and groups are defined in “Samples & groups”.</p>
      </Section>

      <Section title="Detection" hint={`Ct > ${s.ctCutoff} = n.d.`}>
        <Num label="Ct cutoff (not detected above)" value={s.ctCutoff} step={0.5} onChange={(v) => patch({ ctCutoff: v })} />
        <Num label="Min. detected replicates" value={s.minDetected} min={1} max={10} onChange={(v) => patch({ minDetected: Math.round(v) })} help="A sample counts as detected for a gene when at least this many technical replicates have a Ct value." />
        <Select
          label="Not detected samples"
          value={s.ndSampleMode}
          onChange={(v) => patch({ ndSampleMode: v })}
          options={[
            ['exclude', 'exclude (report as n.d.)'],
            ['impute', 'set Ct = cutoff (conservative)'],
          ]}
        />
        <Num label="Flag low expression above Ct" value={s.lowConfidenceCt} step={0.5} onChange={(v) => patch({ lowConfidenceCt: v })} />
        <label className="check">
          <input type="checkbox" checked={s.respectOmit} onChange={(e) => patch({ respectOmit: e.target.checked })} />
          Respect “Omit” from instrument software
        </label>
      </Section>

      <Section title="Technical outliers" hint={s.outlierMethod === 'none' ? 'off' : s.outlierMethod}>
        <Select
          label="Method"
          value={s.outlierMethod}
          onChange={(v) => patch({ outlierMethod: v })}
          options={[
            ['median', 'distance from median (recommended)'],
            ['sd', 'replicate SD above threshold'],
            ['dixon', "Dixon's Q test (alpha 0.05)"],
            ['iqr', 'IQR / Tukey fences (legacy)'],
            ['none', 'none'],
          ]}
        />
        {(s.outlierMethod === 'median' || s.outlierMethod === 'sd') && (
          <Num label="Threshold (cycles)" value={s.outlierThreshold} step={0.1} min={0.1} onChange={(v) => patch({ outlierThreshold: v })} />
        )}
        {s.outlierMethod !== 'none' && (
          <Num label="Max. removed per sample" value={s.maxOutliers} min={1} max={3} onChange={(v) => patch({ maxOutliers: Math.round(v) })} />
        )}
        <Num label="Flag replicate SD above" value={s.highSdWarn} step={0.1} onChange={(v) => patch({ highSdWarn: v })} />
        <p className="note">
          {s.outlierMethod === 'iqr'
            ? 'Quartiles from 4 values are unstable; use only to reproduce older analyses.'
            : 'At least two replicates are always kept. Wells can also be excluded by hand in “Quality control”.'}
        </p>
      </Section>

      <Section title="Output" hint={s.outputScale}>
        <Select
          label="Show"
          value={s.outputScale}
          onChange={(v) => patch({ outputScale: v })}
          options={[
            ['rq', 'RQ (2^-ΔΔCt)'],
            ['log2fc', 'log2 fold change (-ΔΔCt)'],
            ['relexpr', '2^-ΔCt (relative to ref. gene)'],
            ['dct', 'ΔCt'],
          ]}
        />
        <Select
          label="Error bars"
          value={s.errorBar}
          onChange={(v) => patch({ errorBar: v })}
          options={[
            ['sd', 'SD'],
            ['sem', 'SEM'],
            ['ci95', '95% CI'],
          ]}
        />
      </Section>

      <Section title="Statistics" hint={family}>
        <Select
          label="Test"
          value={s.testFamily}
          onChange={(v) => patch({ testFamily: v })}
          options={[
            ['auto', 'Recommended (Welch)'],
            ['welch', 'Welch (unequal variances)'],
            ['classic', 'Classical (equal variances)'],
            ['paired', 'Paired (matched replicates)'],
          ]}
        />
        {maxK > 2 && (
          <Select
            label="Comparisons"
            value={s.comparisons}
            onChange={(v) => patch({ comparisons: v })}
            options={[
              ['vsReference', `each group vs. ${s.referenceGroup || 'reference'}`],
              ['allPairs', 'all pairs'],
            ]}
          />
        )}
        {s.targetGenes.length > 1 && (
          <Select
            label="Correct across genes"
            value={s.multiGeneCorrection}
            onChange={(v) => patch({ multiGeneCorrection: v })}
            options={[
              ['none', 'no (each gene separately)'],
              ['BH', 'Benjamini-Hochberg (FDR)'],
              ['holm', 'Holm (FWER)'],
            ]}
          />
        )}
        <Num label="Significance level" value={s.alpha} step={0.01} min={0.001} max={0.2} onChange={(v) => patch({ alpha: v })} />
        <div className="test-used">
          <span className="muted small">Test used</span>
          <strong>{maxK > 2 ? TEST_LABELS[family][s.comparisons] : TEST_LABELS[family].two}</strong>
        </div>
        {rec && (
          <details className="recommend">
            <summary>Why this test?</summary>
            <ul>
              {rec.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </details>
        )}
      </Section>
    </aside>
  );
}