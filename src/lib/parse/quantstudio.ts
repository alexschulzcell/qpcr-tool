import * as XLSX from 'xlsx';

export interface Well {
  /** Unique id: file index + well position */
  id: string;
  fileIndex: number;
  fileName: string;
  /** Well position, e.g. "A1" */
  position: string;
  row: number;
  col: number;
  sample: string;
  target: string;
  task: string;
  reporter: string;
  /** Numeric Ct, null when undetermined / missing */
  ct: number | null;
  ctRaw: string;
  undetermined: boolean;
  /** "Omit" flag set in the instrument software */
  omit: boolean;
  /** Instrument QC flags set to Y (e.g. NOAMP, HIGHSD) */
  flags: string[];
  ampStatus: string;
}

export interface ParsedFile {
  name: string;
  sheetName: string;
  experimentName: string;
  instrument: string;
  meta: Record<string, string>;
  endogenousControl?: string;
  referenceSample?: string;
  plateFormat: 96 | 384;
  wells: Well[];
  warnings: string[];
}

const FLAG_COLUMNS = [
  'EXPFAIL', 'PRFLOW', 'NOISE', 'HIGHSD', 'SPIKE', 'NOAMP', 'PRFDROP', 'CTFAIL',
  'OUTLIERRG', 'THOLDFAIL', 'BADROX', 'MTP', 'AMPNC', 'BLFAIL', 'NOSIGNAL',
];

const norm = (s: unknown) => String(s ?? '').trim();
const key = (s: unknown) => norm(s).toLowerCase().replace(/\u0442/g, 't'); // Cyrillic "t" used in "C\u0442"

function isCtHeader(h: string) {
  const k = key(h);
  return k === 'ct' || k === 'cq' || k === 'crt' || k === 'c t';
}

function findHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 200); i++) {
    const r = rows[i] ?? [];
    const ks = r.map(key);
    const hasWell = ks.includes('well') || ks.includes('well position');
    const hasSample = ks.includes('sample name') || ks.includes('sample');
    const hasCt = r.some((c) => isCtHeader(norm(c)));
    if (hasWell && hasSample && hasCt) return i;
  }
  return -1;
}

/** Parse a Ct cell. Handles numbers, comma decimals and "Undetermined". */
export function parseCt(v: unknown): { ct: number | null; undetermined: boolean; raw: string } {
  if (typeof v === 'number') return { ct: Number.isFinite(v) ? v : null, undetermined: false, raw: String(v) };
  const raw = norm(v);
  if (raw === '') return { ct: null, undetermined: false, raw };
  const k = raw.toLowerCase();
  if (k === 'undetermined' || k === 'undet' || k === 'no ct' || k === 'n/a' || k === 'na' || k === '-') {
    return { ct: null, undetermined: true, raw };
  }
  const num = Number(raw.replace(',', '.'));
  return Number.isFinite(num) ? { ct: num, undetermined: false, raw } : { ct: null, undetermined: true, raw };
}

function parsePosition(pos: string): { row: number; col: number } {
  const m = /^([A-Pa-p])\s*0*(\d{1,2})$/.exec(pos.trim());
  if (!m) return { row: -1, col: -1 };
  return { row: m[1].toUpperCase().charCodeAt(0) - 65, col: Number(m[2]) - 1 };
}

function wellNumberToPosition(n: number, format: 96 | 384): string {
  const cols = format === 384 ? 24 : 12;
  const r = Math.floor((n - 1) / cols);
  const c = ((n - 1) % cols) + 1;
  return String.fromCharCode(65 + r) + c;
}

const truthy = (v: unknown) => {
  const k = key(v);
  return k === 'true' || k === 'y' || k === 'yes' || k === '1';
};

function parseSheet(rows: unknown[][], fileIndex: number, fileName: string, sheetName: string): ParsedFile | null {
  const hi = findHeaderRow(rows);
  if (hi < 0) return null;
  const header = (rows[hi] ?? []).map(norm);
  const col = (...names: string[]) => {
    for (const n of names) {
      const idx = header.findIndex((h) => key(h) === n);
      if (idx >= 0) return idx;
    }
    return -1;
  };
  const iWell = col('well');
  const iPos = col('well position');
  const iSample = col('sample name', 'sample');
  const iTarget = col('target name', 'target', 'detector', 'gene');
  const iTask = col('task');
  const iReporter = col('reporter', 'reporter dye', 'dye');
  const iOmit = col('omit');
  const iAmp = col('amp status');
  const iCt = header.findIndex(isCtHeader);
  const flagIdx = FLAG_COLUMNS.map((f) => [f, header.findIndex((h) => h.toUpperCase() === f)] as const).filter(
    ([, i]) => i >= 0,
  );

  const meta: Record<string, string> = {};
  for (let i = 0; i < hi; i++) {
    const r = rows[i] ?? [];
    const k = norm(r[0]).replace(/^\*\s*/, '');
    if (k) meta[k] = norm(r[1]);
  }

  const warnings: string[] = [];
  const wells: Well[] = [];
  let i = hi + 1;
  let maxRow = 0;
  let maxCol = 0;
  for (; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const wellCell = iWell >= 0 ? r[iWell] : r[iPos];
    if (wellCell === undefined || wellCell === null || norm(wellCell) === '') break;
    // A non-well value in the first column marks the start of the footer block.
    if (!/^(\d+|[A-Pa-p]\s*\d{1,2})$/.test(norm(wellCell))) break;
    const sample = norm(r[iSample]);
    const target = iTarget >= 0 ? norm(r[iTarget]) : '';
    if (!sample && !target) continue; // empty well
    let position = iPos >= 0 ? norm(r[iPos]) : norm(wellCell);
    if (/^\d+$/.test(position)) position = wellNumberToPosition(Number(position), 384);
    const { row, col: c } = parsePosition(position);
    maxRow = Math.max(maxRow, row);
    maxCol = Math.max(maxCol, c);
    const ct = parseCt(r[iCt]);
    wells.push({
      id: `${fileIndex}:${position}`,
      fileIndex,
      fileName,
      position,
      row,
      col: c,
      sample,
      target,
      task: iTask >= 0 ? norm(r[iTask]).toUpperCase() : 'UNKNOWN',
      reporter: iReporter >= 0 ? norm(r[iReporter]) : '',
      ct: ct.ct,
      ctRaw: ct.raw,
      undetermined: ct.undetermined,
      omit: iOmit >= 0 ? truthy(r[iOmit]) : false,
      flags: flagIdx.filter(([, fi]) => truthy(r[fi])).map(([f]) => f),
      ampStatus: iAmp >= 0 ? norm(r[iAmp]) : '',
    });
  }
  // Footer key/value block (e.g. "Endogenous Control", "Reference Sample")
  for (; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const k = norm(r[0]);
    if (k && r.length > 1) meta[k] = norm(r[1]);
  }

  const blockType = meta['Block Type'] ?? '';
  const plateFormat: 96 | 384 = /384/.test(blockType) || maxRow > 7 || maxCol > 11 ? 384 : 96;
  if (wells.length === 0) warnings.push('No wells found below the header row.');
  if (iTarget < 0) warnings.push('No target column found.');

  return {
    name: fileName,
    sheetName,
    experimentName: meta['Experiment Name'] ?? fileName,
    instrument: meta['Instrument Type'] ?? '',
    meta,
    endogenousControl: meta['Endogenous Control'] || undefined,
    referenceSample: meta['Reference Sample'] || undefined,
    plateFormat,
    wells,
    warnings,
  };
}

/**
 * Parse a QuantStudio export (xlsx/xls/csv/txt). Prefers the "Results" sheet,
 * otherwise uses the first sheet containing a Well / Sample / Ct header.
 */
export function parseQuantStudio(data: ArrayBuffer, fileName: string, fileIndex = 0): ParsedFile {
  const wb = XLSX.read(data, { type: 'array', raw: false, cellDates: false, dense: true });
  const order = [
    ...wb.SheetNames.filter((n) => n.trim().toLowerCase() === 'results'),
    ...wb.SheetNames.filter((n) => n.trim().toLowerCase() !== 'results'),
  ];
  for (const sheetName of order) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], {
      header: 1,
      raw: true,
      defval: null,
      blankrows: true,
    });
    const parsed = parseSheet(rows, fileIndex, fileName, sheetName);
    if (parsed && parsed.wells.length > 0) return parsed;
  }
  throw new Error(
    `No results table found in "${fileName}". Expected a sheet (ideally "Results") with the columns Well, Sample Name, Target Name and CT.`,
  );
}