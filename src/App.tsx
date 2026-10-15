import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { parseQuantStudio, type ParsedFile } from './lib/parse/quantstudio';
import { autoDesign, type Design } from './lib/analysis/design';
import { runAnalysis } from './lib/analysis/pipeline';
import { DEFAULT_SETTINGS, type Settings } from './lib/analysis/types';
import { makeExampleFile } from './lib/example';
import { Dropzone } from './components/Dropzone';
import { Sidebar } from './components/Sidebar';
import { ResultsView } from './components/ResultsView';
import { SamplesView } from './components/SamplesView';
import { QCView } from './components/QCView';
import { ExportView } from './components/ExportView';
import { DEFAULT_PLOT_STYLE, type PlotStyle } from './components/ExpressionPlot';

import { VERSION } from './lib/version';

const COMMON_HK = ['RPLP0', 'GAPDH', 'ACTB', 'B2M', 'HPRT1', 'HPRT', 'TBP', '18S', 'RN18S1', 'YWHAZ', 'PPIA', 'UBC', 'GUSB', 'HMBS', 'SDHA', 'RPL13A', 'EEF1A1', 'TUBB', 'PGK1', 'RPS18'];
const REF_GROUP_PATTERN = /^(wt|ctrl|control|untreated|mock|undiff|undifferentiated|nc|scr|scrambled|vehicle|dmso|sham|baseline|day ?0|d0)$/i;

type Tab = 'results' | 'samples' | 'qc' | 'export';

const STORAGE_KEY = 'qpcr-tool:prefs:v1';
type Prefs = { settings: Partial<Settings>; plotStyle: PlotStyle };
const GENERIC_KEYS: (keyof Settings)[] = [
  'ctCutoff', 'lowConfidenceCt', 'minDetected', 'ndSampleMode', 'respectOmit', 'outlierMethod',
  'outlierThreshold', 'maxOutliers', 'highSdWarn', 'outputScale', 'errorBar', 'testFamily', 'comparisons',
  'alpha', 'multiGeneCorrection', 'referenceScope',
];

function loadPrefs(): Prefs | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Prefs) : null;
  } catch {
    return null;
  }
}

function initialSettings(files: ParsedFile[], design: Design, prev: Settings): Settings {
  const wells = files.flatMap((f) => f.wells).filter((w) => w.task !== 'NTC');
  const targets = [...new Set(wells.map((w) => w.target).filter(Boolean))];
  const endo = files.map((f) => f.endogenousControl).find((e) => e && targets.includes(e));
  const hk = endo ? [endo] : targets.filter((t) => COMMON_HK.includes(t.toUpperCase())).slice(0, 1);
  if (hk.length === 0 && targets.length) hk.push(targets[0]);
  const groups = [...new Set(design.conditions.map((c) => c.group))];
  let ref = groups.find((g) => REF_GROUP_PATTERN.test(g));
  if (!ref) {
    const refSample = files.map((f) => f.referenceSample).find(Boolean);
    const smp = design.samples.find((x) => x.sample === refSample);
    ref = design.conditions.find((c) => c.name === smp?.condition)?.group;
  }
  return {
    ...prev,
    hkGenes: hk,
    // other typical reference genes are left unassigned rather than analysed as targets
    targetGenes: targets.filter((t) => !hk.includes(t) && !COMMON_HK.includes(t.toUpperCase())),
    efficiencies: {},
    manualExcluded: [],
    referenceGroup: ref ?? groups[0] ?? '',
  };
}

export default function App() {
  const prefs = useMemo(loadPrefs, []);
  const [files, setFiles] = useState<ParsedFile[]>([]);
  const [design, setDesign] = useState<Design>({ samples: [], conditions: [] });
  const [settings, setSettings] = useState<Settings>({ ...DEFAULT_SETTINGS, ...(prefs?.settings ?? {}) });
  const [plotStyle, setPlotStyle] = useState<PlotStyle>({ ...DEFAULT_PLOT_STYLE, ...(prefs?.plotStyle ?? {}) });
  const [tab, setTab] = useState<Tab>('results');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const generic = Object.fromEntries(GENERIC_KEYS.map((k) => [k, settings[k]]));
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ settings: generic, plotStyle }));
    } catch {
      /* storage unavailable */
    }
  }, [settings, plotStyle]);

  const wells = useMemo(() => files.flatMap((f) => f.wells), [files]);

  const loadFiles = useCallback(
    async (list: File[], append: boolean) => {
      setError(null);
      const parsed: ParsedFile[] = [];
      const offset = append ? files.length : 0;
      for (const [i, f] of list.entries()) {
        try {
          parsed.push(parseQuantStudio(await f.arrayBuffer(), f.name, offset + i));
        } catch (e) {
          setError((e as Error).message);
          return;
        }
      }
      const next = append ? [...files, ...parsed] : parsed;
      const d = autoDesign(next.flatMap((f) => f.wells));
      if (append) {
        // keep edits made to existing conditions / samples
        d.conditions = d.conditions.map((c) => design.conditions.find((x) => x.name === c.name) ?? c);
        d.samples = d.samples.map((x) => design.samples.find((y) => y.sample === x.sample) ?? x);
      }
      setFiles(next);
      setDesign(d);
      setSettings((prev) => (append ? { ...prev, targetGenes: [...new Set([...prev.targetGenes, ...initialSettings(next, d, prev).targetGenes])].filter((t) => !prev.hkGenes.includes(t)) } : initialSettings(next, d, prev)));
      setTab('results');
    },
    [files, design],
  );

  const loadExample = () => {
    const f = makeExampleFile();
    const d = autoDesign(f.wells);
    setFiles([f]);
    setDesign(d);
    setSettings((prev) => initialSettings([f], d, prev));
    setTab('results');
  };

  const reset = () => {
    setFiles([]);
    setDesign({ samples: [], conditions: [] });
    setError(null);
  };

  const patch = useCallback((p: Partial<Settings>) => setSettings((s) => ({ ...s, ...p })), []);
  const toggleWell = useCallback(
    (id: string) =>
      setSettings((s) => ({
        ...s,
        manualExcluded: s.manualExcluded.includes(id) ? s.manualExcluded.filter((x) => x !== id) : [...s.manualExcluded, id],
      })),
    [],
  );

  const dWells = useDeferredValue(wells);
  const dDesign = useDeferredValue(design);
  const dSettings = useDeferredValue(settings);
  const result = useMemo(() => (dWells.length ? runAnalysis(dWells, dDesign, dSettings) : null), [dWells, dDesign, dSettings]);
  const stale = dSettings !== settings || dDesign !== design;

  if (files.length === 0) {
    return (
      <div className="landing">
        <header className="landing-head">
          <Logo />
          <div>
            <h1>qPCR Tool</h1>
            <p className="muted">Relative quantification (ΔΔCt) and statistics for QuantStudio exports</p>
          </div>
        </header>
        <Dropzone onFiles={(f) => loadFiles(f, false)} />
        {error && <div className="alert error">{error}</div>}
        <div className="landing-actions">
          <button className="btn ghost" onClick={loadExample}>
            Try with example data
          </button>
        </div>
        <section className="landing-info">
          <div>
            <h3>Private by design</h3>
            <p>Files are read and analysed entirely in your browser. No data are uploaded anywhere.</p>
          </div>
          <div>
            <h3>Validated</h3>
            <p>All statistics are tested against R (t.test, oneway.test, TukeyHSD, multcomp). Every analysis can be exported as an R script that reproduces it.</p>
          </div>
          <div>
            <h3>Publication-ready</h3>
            <p>Vector figures (SVG) and 300/600 dpi PNGs, Excel tables, Prism-ready columns and a methods paragraph.</p>
          </div>
        </section>
        <footer className="foot">qPCR Tool v{VERSION}</footer>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <Logo />
          <span>qPCR Tool</span>
        </div>
        <div className="file-chips">
          {files.map((f) => (
            <span key={f.name + f.wells.length} className="chip" title={`${f.instrument} · ${f.wells.length} wells · sheet "${f.sheetName}"`}>
              {f.experimentName}
            </span>
          ))}
        </div>
        <div className="topbar-actions">
          <label className="btn small ghost">
            Add plate
            <input
              type="file"
              accept=".xlsx,.xls,.csv,.txt"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files?.length) loadFiles([...e.target.files], true);
                e.target.value = '';
              }}
            />
          </label>
          <button className="btn small ghost" onClick={reset}>
            New analysis
          </button>
        </div>
      </header>
      {error && <div className="alert error">{error}</div>}
      <div className="layout">
        <Sidebar files={files} design={design} settings={settings} patch={patch} result={result} />
        <main className="main">
          <nav className="tabs">
            {(
              [
                ['results', 'Results'],
                ['samples', 'Samples & groups'],
                ['qc', 'Quality control'],
                ['export', 'Export'],
              ] as [Tab, string][]
            ).map(([k, label]) => (
              <button key={k} className={tab === k ? 'tab active' : 'tab'} onClick={() => setTab(k)}>
                {label}
                {k === 'qc' && result && result.hkStability.some((h) => h.warn) ? <span className="dot-warn" /> : null}
              </button>
            ))}
            {stale && <span className="computing">updating…</span>}
          </nav>
          {result && tab === 'results' && (
            <ResultsView result={result} settings={settings} style={plotStyle} setStyle={setPlotStyle} />
          )}
          {tab === 'samples' && <SamplesView design={design} setDesign={setDesign} wells={wells} />}
          {result && tab === 'qc' && (
            <QCView files={files} result={result} settings={settings} toggleWell={toggleWell} patch={patch} />
          )}
          {result && tab === 'export' && (
            <ExportView
              files={files}
              design={design}
              settings={settings}
              result={result}
              plotStyle={plotStyle}
              onLoadSettings={(s, d, ps) => {
                setSettings(s);
                if (d) setDesign(d);
                if (ps) setPlotStyle(ps);
              }}
            />
          )}
        </main>
      </div>
      <footer className="foot">
        qPCR Tool v{VERSION} · all processing happens locally in your browser
      </footer>
    </div>
  );
}

function Logo() {
  return (
    <svg className="logo" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="var(--accent)" />
      <path d="M5 25 C 12 25, 13 7, 18 7 S 24 7, 27 7" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}