import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { makeExampleFile } from '../src/lib/example';
import { autoDesign } from '../src/lib/analysis/design';
import { runAnalysis } from '../src/lib/analysis/pipeline';
import { DEFAULT_SETTINGS, type Settings } from '../src/lib/analysis/types';
import { buildWorkbook } from '../src/lib/export/excel';
import { generateMethods } from '../src/lib/export/methods';
import { parseQuantStudio } from '../src/lib/parse/quantstudio';

const file = makeExampleFile();
const design = autoDesign(file.wells);
const s: Settings = { ...DEFAULT_SETTINGS, hkGenes: ['RPLP0'], targetGenes: ['LAMA5', 'SOX9'], referenceGroup: 'WT' };
const res = runAnalysis(file.wells, design, s);

describe('exports', () => {
  it('builds a readable workbook with all sheets', () => {
    const wb = buildWorkbook([file], design, s, res, 'test');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const back = XLSX.read(buf, { type: 'array' });
    expect(back.SheetNames).toEqual([
      'Summary', 'Statistics', 'Biological replicates', 'Technical replicates', 'Wells',
      'Prism LAMA5', 'Prism SOX9', 'Reference gene QC', 'Settings', 'Methods',
    ]);
    const summary = XLSX.utils.sheet_to_json<Record<string, unknown>>(back.Sheets.Summary);
    expect(summary.length).toBe(res.summaries.length);
    const wells = XLSX.utils.sheet_to_json(back.Sheets.Wells);
    expect(wells.length).toBe(res.sampleTargets.reduce((a, x) => a + x.nTotal, 0));
  });

  it('writes a methods paragraph that reflects the settings', () => {
    const m = generateMethods([file], { ...s, testFamily: 'classic', comparisons: 'allPairs' }, res, '1.2.3');
    expect(m.text).toContain('qPCR Tool v1.2.3');
    expect(m.text).toContain('Ct > 40');
    expect(m.references.some((r) => r.startsWith('Livak'))).toBe(true);
  });

  it('round-trips a QuantStudio-like workbook through the parser', () => {
    // Re-create the QuantStudio layout: metadata block, header row at line 37, footer
    const aoa: unknown[][] = [
      ['Block Type', '384-Well Block'],
      ['Experiment Name', 'Roundtrip'],
      ['Instrument Type', 'QuantStudio 12K Flex'],
    ];
    while (aoa.length < 36) aoa.push([]);
    aoa.push(['Well', 'Well Position', 'Omit', 'Sample Name', 'Target Name', 'Task', 'Reporter', 'CT', 'Amp Status', 'NOAMP']);
    file.wells.forEach((w, i) =>
      aoa.push([i + 1, w.position, i === 5 ? 'true' : 'false', w.sample, w.target, 'UNKNOWN', w.reporter, w.ct === null ? 'Undetermined' : w.ct.toFixed(3).replace('.', i % 7 === 0 ? ',' : '.'), w.ampStatus, w.ct === null ? 'Y' : 'N']),
    );
    aoa.push([], ['Analysis Type', 'Singleplex'], ['Endogenous Control', 'RPLP0'], ['Reference Sample', 'WT1']);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['x']]), 'Amplification Data');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Results');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const parsed = parseQuantStudio(buf, 'roundtrip.xlsx');
    expect(parsed.sheetName).toBe('Results');
    expect(parsed.wells.length).toBe(file.wells.length);
    expect(parsed.endogenousControl).toBe('RPLP0');
    expect(parsed.referenceSample).toBe('WT1');
    expect(parsed.plateFormat).toBe(384);
    expect(parsed.wells[5].omit).toBe(true);
    expect(parsed.wells[7].ct).toBeCloseTo(file.wells[7].ct!, 3); // comma decimal
    const und = parsed.wells.filter((w) => w.undetermined);
    expect(und.length).toBe(file.wells.filter((w) => w.ct === null).length);
    expect(und.every((w) => w.flags.includes('NOAMP'))).toBe(true);
  });
});