import type { Well } from '../parse/quantstudio';
import type { Condition, SampleInfo } from './types';

/** Split a sample name into stem and trailing replicate number: "chKO1" -> ["chKO", "1"], "KO LiCl 4" -> ["KO LiCl", "4"]. */
export function splitSampleName(name: string): { stem: string; rep: string } {
  const m = /^(.*?)[\s_\-.#]*(\d+)$/.exec(name.trim());
  if (m && m[1].trim() !== '') return { stem: m[1].trim(), rep: m[2] };
  return { stem: name.trim(), rep: '1' };
}

export const NO_PANEL = '';

/**
 * Try to split condition stems into panel x group.
 * Strategy 1: some stems are suffixes of others ("WT", "chWT", "oWT") -> prefix = panel.
 * Strategy 2: all stems have exactly two whitespace/underscore separated tokens forming a grid.
 */
export function proposeFactors(stems: string[]): Record<string, { panel: string; group: string }> | null {
  const uniq = [...new Set(stems)];
  if (uniq.length < 3) return null;

  // Strategy 1
  const suffixes = uniq.filter((s) => uniq.some((o) => o !== s && o.endsWith(s)));
  if (suffixes.length >= 2) {
    const out: Record<string, { panel: string; group: string }> = {};
    let ok = true;
    for (const s of uniq) {
      const suf = suffixes.filter((x) => s.endsWith(x)).sort((a, b) => b.length - a.length)[0];
      if (!suf) {
        ok = false;
        break;
      }
      out[s] = { panel: s.slice(0, s.length - suf.length).replace(/[\s_\-.]+$/, ''), group: suf };
    }
    const panels = new Set(Object.values(out).map((v) => v.panel));
    if (ok && panels.size >= 2) return out;
  }

  // Strategy 2
  const tokens = uniq.map((s) => s.split(/[\s_]+/));
  if (tokens.every((t) => t.length === 2)) {
    const a = new Set(tokens.map((t) => t[0]));
    const b = new Set(tokens.map((t) => t[1]));
    if (a.size >= 2 && b.size >= 2) {
      const out: Record<string, { panel: string; group: string }> = {};
      uniq.forEach((s, i) => (out[s] = { panel: tokens[i][1], group: tokens[i][0] }));
      return out;
    }
  }
  return null;
}

export interface Design {
  samples: SampleInfo[];
  conditions: Condition[];
}

/** Build an initial design from the wells (unknown-task wells only). */
export function autoDesign(wells: Well[]): Design {
  const sampleNames: string[] = [];
  for (const w of wells) {
    if (!w.sample || w.task === 'NTC' || w.task === 'STANDARD') continue;
    if (!sampleNames.includes(w.sample)) sampleNames.push(w.sample);
  }
  const samples: SampleInfo[] = sampleNames.map((s) => {
    const { stem, rep } = splitSampleName(s);
    return { sample: s, condition: stem, biorep: rep, include: true };
  });
  const stems = [...new Set(samples.map((s) => s.condition))];
  const factors = proposeFactors(stems);
  const conditions: Condition[] = stems.map((name) => ({
    name,
    panel: factors?.[name]?.panel ?? NO_PANEL,
    group: factors?.[name]?.group ?? name,
    include: true,
  }));
  return { samples, conditions };
}

/** Label used for the empty panel in the UI and exports. */
export function panelLabel(panel: string, hasPanels: boolean): string {
  if (!hasPanels) return 'All samples';
  return panel === NO_PANEL ? '(no prefix)' : panel;
}