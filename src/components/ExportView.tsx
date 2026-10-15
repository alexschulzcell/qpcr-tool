import { useMemo, useRef, useState } from 'react';
import type { ParsedFile } from '../lib/parse/quantstudio';
import type { Design } from '../lib/analysis/design';
import { DEFAULT_SETTINGS, type AnalysisResult, type Settings } from '../lib/analysis/types';
import { buildWorkbook, downloadWorkbook } from '../lib/export/excel';
import { generateRScript } from '../lib/export/rscript';
import { generateMethods } from '../lib/export/methods';
import { downloadText } from '../lib/download';
import { sanitizeFileName } from '../lib/format';
import type { PlotStyle } from './ExpressionPlot';
import { VERSION } from '../lib/version';

interface Props {
  files: ParsedFile[];
  design: Design;
  settings: Settings;
  result: AnalysisResult;
  plotStyle: PlotStyle;
  onLoadSettings: (s: Settings, d: Design | null, ps: PlotStyle | null) => void;
}

export function ExportView({ files, design, settings, result, plotStyle, onLoadSettings }: Props) {
  const base = sanitizeFileName(files.map((f) => f.experimentName).join('_'));
  const methods = useMemo(() => generateMethods(files, settings, result, VERSION), [files, settings, result]);
  const [copied, setCopied] = useState(false);
  const [loadMsg, setLoadMsg] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const copy = async () => {
    const full = `${methods.text}\n\nReferences\n${methods.references.join('\n')}`;
    try {
      await navigator.clipboard.writeText(full);
    } catch {
      textRef.current?.select();
      document.execCommand('copy');
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const saveAnalysis = () => {
    const payload = {
      app: 'qpcr-tool',
      version: VERSION,
      saved: new Date().toISOString(),
      files: files.map((f) => f.name),
      settings,
      design,
      plotStyle,
    };
    downloadText(JSON.stringify(payload, null, 2), `${base}_analysis.json`, 'application/json');
  };

  return (
    <div className="export">
      <div className="export-grid">
        <div className="card export-card">
          <h3>Results workbook</h3>
          <p className="muted">Summary, statistics, biological and technical replicates, every well with its inclusion decision, Prism-ready columns, reference-gene QC, settings and methods.</p>
          <button className="btn primary" onClick={() => downloadWorkbook(buildWorkbook(files, design, settings, result, VERSION), `${base}_qPCR_results.xlsx`)}>
            Download Excel (.xlsx)
          </button>
        </div>
        <div className="card export-card">
          <h3>R reproducibility script</h3>
          <p className="muted">Standalone R script containing all Ct values and inclusion decisions. It recomputes every value and test in base R — ideal as supplementary material.</p>
          <button className="btn" onClick={() => downloadText(generateRScript(files, design, settings, result, VERSION), `${base}_qPCR_analysis.R`)}>
            Download R script (.R)
          </button>
        </div>
        <div className="card export-card">
          <h3>Analysis settings</h3>
          <p className="muted">Save the complete set-up (genes, groups, exclusions, figure style) to reproduce or continue later with the same export file.</p>
          <div className="row-btns">
            <button className="btn" onClick={saveAnalysis}>Save (.json)</button>
            <label className="btn ghost">
              Load…
              <input
                type="file"
                accept=".json"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f) return;
                  try {
                    const j = JSON.parse(await f.text());
                    if (j.app !== 'qpcr-tool') throw new Error('Not a qPCR Tool analysis file.');
                    onLoadSettings({ ...DEFAULT_SETTINGS, ...j.settings }, j.design ?? null, j.plotStyle ?? null);
                    const missing = (j.files ?? []).filter((n: string) => !files.some((x) => x.name === n));
                    setLoadMsg(missing.length ? `Loaded. Note: saved with other file(s): ${missing.join(', ')}` : 'Analysis settings loaded.');
                  } catch (err) {
                    setLoadMsg((err as Error).message);
                  }
                }}
              />
            </label>
          </div>
          {loadMsg && <p className="note">{loadMsg}</p>}
        </div>
      </div>

      <div className="card">
        <header className="card-head">
          <h2>Methods (draft)</h2>
          <div className="spacer" />
          <button className="btn tiny" onClick={copy}>{copied ? 'Copied ✓' : 'Copy text'}</button>
        </header>
        <textarea ref={textRef} className="methods" readOnly value={methods.text} rows={10} />
        <h4>References</h4>
        <ol className="refs">
          {methods.references.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ol>
        <h4>Citing this software</h4>
        <p className="muted">{methods.citation}</p>
        <p className="note">
          Check the draft against what you actually did (e.g. instrument, chemistry, primer validation) and add MIQE-relevant details
          (RNA quality, reverse transcription, primer sequences and efficiencies).
        </p>
      </div>
    </div>
  );
}