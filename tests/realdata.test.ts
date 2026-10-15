/**
 * End-to-end checks on real QuantStudio exports. The data are not part of the
 * repository; set QPCR_DATA_DIR to a folder with exports to run these tests.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseQuantStudio } from '../src/lib/parse/quantstudio';
import { autoDesign } from '../src/lib/analysis/design';
import { runAnalysis } from '../src/lib/analysis/pipeline';
import { DEFAULT_SETTINGS } from '../src/lib/analysis/types';

const dir = process.env.QPCR_DATA_DIR;
const files = dir && existsSync(dir) ? readdirSync(dir).filter((f) => /\.(xlsx|xls|csv|txt)$/i.test(f)) : [];

describe.skipIf(files.length === 0)('real exports', () => {
  for (const f of files) {
    it(`parses ${f}`, () => {
      const buf = readFileSync(join(dir!, f));
      const parsed = parseQuantStudio(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), f);
      expect(parsed.wells.length).toBeGreaterThan(0);
      const design = autoDesign(parsed.wells);
      const targets = [...new Set(parsed.wells.map((w) => w.target))];
      const hk = parsed.endogenousControl && targets.includes(parsed.endogenousControl) ? parsed.endogenousControl : targets[0];
      const groups = [...new Set(design.conditions.map((c) => c.group))];
      const settings = {
        ...DEFAULT_SETTINGS,
        hkGenes: [hk],
        targetGenes: targets.filter((t) => t !== hk),
        referenceGroup: groups.includes('WT') ? 'WT' : groups[0],
        ...(process.env.QPCR_OUTLIER ? { outlierMethod: process.env.QPCR_OUTLIER as any, maxOutliers: 4 } : {}),
      };
      const res = runAnalysis(parsed.wells, design, settings);
      if (process.env.QPCR_VERBOSE) {
        console.log(f, parsed.plateFormat, parsed.wells.length, 'wells');
        console.log(design.conditions);
        console.log(res.warnings);
        for (const s of res.summaries) console.log(s.target, s.panel, s.group, s.n, s.rq.toFixed(4), s.meanDct.toFixed(4));
        for (const st of res.stats) for (const c of st.comparisons) console.log(st.target, st.panel, st.testName, c.group1, c.group2, c.diffDct.toFixed(4), c.p.toPrecision(4), c.pAdj.toPrecision(4));
      }
      expect(res.summaries.length).toBeGreaterThan(0);
    });
  }
});