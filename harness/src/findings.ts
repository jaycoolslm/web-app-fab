/**
 * The findings contract. findings.json is the single source of truth for a pass's verdict:
 * the Evaluator writes it, deterministic stages synthesize it on failure, the Generator is
 * fed the previous pass's file verbatim, and stable finding ids are tracked across passes
 * to drive model escalation.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export type Verdict = 'PASS' | 'FAIL';
export type Severity = 'critical' | 'major' | 'minor';

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

/** A deterministic finding written by the harness itself (assert/smoke/agent failures). */
export function syntheticFinding(summary: string, detail: string): Finding {
  const id = 'env-' + createHash('sha1').update(summary).digest('hex').slice(0, 10);
  return { id, severity: 'critical', summary, detail: detail.slice(-2000), status: 'open' };
}

const SEVERITIES: Severity[] = ['critical', 'major', 'minor'];

/** Validate an unknown value into a FindingsFile, or explain why it isn't one. */
export function parseFindings(value: unknown): { file?: FindingsFile; error?: string } {
  const f = value as FindingsFile;
  if (typeof f !== 'object' || f === null) return { error: 'not an object' };
  if (f.verdict !== 'PASS' && f.verdict !== 'FAIL') return { error: `bad verdict: ${JSON.stringify(f.verdict)}` };
  if (!Array.isArray(f.findings)) return { error: 'findings is not an array' };
  for (const [i, fd] of f.findings.entries()) {
    if (typeof fd?.id !== 'string' || fd.id === '') return { error: `finding ${i}: missing id` };
    if (!SEVERITIES.includes(fd.severity)) return { error: `finding ${i}: bad severity` };
    if (typeof fd.summary !== 'string' || fd.summary === '') return { error: `finding ${i}: missing summary` };
    if (fd.status !== 'open' && fd.status !== 'fixed') return { error: `finding ${i}: bad status` };
  }
  if (f.verdict === 'PASS' && f.findings.some((fd) => fd.status === 'open')) {
    return { error: 'verdict is PASS but open findings remain' };
  }
  return { file: f };
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

export function writeFindings(path: string, file: FindingsFile): void {
  writeFileSync(path, JSON.stringify(file, null, 2) + '\n');
}

export function openFindingIds(file: FindingsFile | undefined): string[] {
  return file?.findings.filter((f) => f.status === 'open').map((f) => f.id) ?? [];
}
