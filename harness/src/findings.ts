/**
 * The findings contract. findings.json is the single source of truth for a pass's verdict:
 * the Evaluator writes it, deterministic stages synthesize it on failure, the Generator is
 * fed the previous pass's file verbatim, and stable finding ids are tracked across passes
 * to drive model escalation.
 *
 * Two agents write findings now. The functional Evaluator writes findings.json unchanged; the
 * UX Evaluator writes findings-ux.json, which carries no verdict — the harness merges the two
 * into the canonical findings.json and decides the verdict itself (see {@link mergeVerdict}).
 * Ids are namespaced per source so the two can never collide across passes.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export type Verdict = 'PASS' | 'FAIL';
export type Severity = 'critical' | 'major' | 'minor';

/** Id namespaces: functional findings, visual/interaction findings. */
export const FN_PREFIX = 'fn-';
export const UX_PREFIX = 'ux-';

export interface Finding {
  /** Stable identity for cross-pass tracking; the Evaluator reuses ids for surviving issues. */
  id: string;
  severity: Severity;
  summary: string;
  /** Evidence / repro / log tail. */
  detail?: string;
  status: 'open' | 'fixed';
}

export interface FindingsFile {
  pass: number;
  verdict: Verdict;
  findings: Finding[];
}

/** What the UX Evaluator writes: findings only. The verdict is the harness's to decide. */
export interface UxFindingsFile {
  pass: number;
  findings: Finding[];
}

/** A deterministic finding written by the harness itself (assert/smoke/agent failures). */
export function syntheticFinding(summary: string, detail: string): Finding {
  const id = 'env-' + createHash('sha1').update(summary).digest('hex').slice(0, 10);
  return { id, severity: 'critical', summary, detail: detail.slice(-2000), status: 'open' };
}

const SEVERITIES: Severity[] = ['critical', 'major', 'minor'];

/**
 * The blocking policy, in one place. Every open functional finding blocks delivery; an open UX
 * finding blocks only at critical or major. A slice that behaves correctly but has slightly
 * cramped padding must not burn its whole pass budget and end `failed` on a cosmetic nit.
 */
const blocks = (f: Finding): boolean =>
  f.status === 'open' && (!f.id.startsWith(UX_PREFIX) || f.severity !== 'minor');

/** Validate the findings array shared by both file shapes. */
function parseFindingList(value: unknown): { findings?: Finding[]; error?: string } {
  const findings = value as Finding[];
  if (!Array.isArray(findings)) return { error: 'findings is not an array' };
  for (const [i, fd] of findings.entries()) {
    if (typeof fd?.id !== 'string' || fd.id === '') return { error: `finding ${i}: missing id` };
    if (!SEVERITIES.includes(fd.severity)) return { error: `finding ${i}: bad severity` };
    if (typeof fd.summary !== 'string' || fd.summary === '') return { error: `finding ${i}: missing summary` };
    if (fd.status !== 'open' && fd.status !== 'fixed') return { error: `finding ${i}: bad status` };
  }
  return { findings };
}

/** Validate an unknown value into a FindingsFile, or explain why it isn't one. */
export function parseFindings(value: unknown): { file?: FindingsFile; error?: string } {
  const f = value as FindingsFile;
  if (typeof f !== 'object' || f === null) return { error: 'not an object' };
  if (f.verdict !== 'PASS' && f.verdict !== 'FAIL') return { error: `bad verdict: ${JSON.stringify(f.verdict)}` };
  const { findings, error } = parseFindingList(f.findings);
  if (!findings) return { error };
  // Unchanged for the functional Evaluator's own file, which only ever holds fn-/env- ids: a
  // PASS there still may not leave anything open. The merged file may carry open minor UX
  // findings under a PASS, which is exactly what the blocking policy says it means.
  if (f.verdict === 'PASS' && findings.some(blocks)) {
    return { error: 'verdict is PASS but blocking findings remain' };
  }
  return { file: f };
}

/**
 * Validate the UX Evaluator's file. A separate function on purpose: loosening parseFindings to
 * accept a missing verdict would weaken the invariant the functional file depends on.
 */
export function parseUxFindings(value: unknown): { file?: UxFindingsFile; error?: string } {
  const f = value as UxFindingsFile;
  if (typeof f !== 'object' || f === null) return { error: 'not an object' };
  const { findings, error } = parseFindingList(f.findings);
  if (!findings) return { error };
  return { file: { pass: Number(f.pass), findings } };
}

export function readFindings(path: string): FindingsFile | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const { file } = parseFindings(JSON.parse(readFileSync(path, 'utf8')));
    return file;
  } catch {
    return undefined;
  }
}

export function readUxFindings(path: string): UxFindingsFile | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const { file } = parseUxFindings(JSON.parse(readFileSync(path, 'utf8')));
    return file;
  } catch {
    return undefined;
  }
}

export function writeFindings(path: string, file: FindingsFile): void {
  writeFileSync(path, JSON.stringify(file, null, 2) + '\n');
}

/**
 * Force a stage's namespace onto its ids. Both prompts ask for the prefix; this is what makes
 * a model that ignored the instruction unable to corrupt cross-pass identity — or to smuggle a
 * cosmetic nit past the blocking policy by writing it into the wrong namespace.
 */
export function namespaceIds(findings: Finding[], prefix: string): Finding[] {
  return findings.map((f) => (f.id.startsWith(prefix) ? f : { ...f, id: prefix + f.id }));
}

/**
 * The merged verdict for a pass. The functional Evaluator's verdict is authoritative for
 * correctness; UX findings can only ever add a FAIL, and only at critical or major.
 */
export function mergeVerdict(functional: Verdict, uxFindings: Finding[]): Verdict {
  if (functional === 'FAIL') return 'FAIL';
  return uxFindings.some(blocks) ? 'FAIL' : 'PASS';
}

export function openFindingIds(file: FindingsFile | undefined): string[] {
  return file?.findings.filter((f) => f.status === 'open').map((f) => f.id) ?? [];
}

/**
 * Open-finding history with UX ids dropped, for model escalation only. state.json keeps the
 * full unfiltered set so the run record stays complete — see resolveGenerateModel in config.ts.
 */
export const escalationHistory = (history: string[][]): string[][] =>
  history.map((ids) => ids.filter((id) => !id.startsWith(UX_PREFIX)));
