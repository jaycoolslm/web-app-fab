/**
 * The pass loop. Per slice (one spec), each pass runs
 *
 *   GENERATE → ASSERT → SMOKE → EVALUATE
 *
 * where ASSERT (deterministic commands) and SMOKE (app boots) short-circuit back to
 * GENERATE with synthetic findings, never spending an Evaluator run on a broken build.
 * findings.json is the verdict; state.json is the resume/skip source of truth. Nothing in
 * a pass-N/ directory is ever overwritten — resuming continues at pass N+1.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startApps } from './apps.ts';
import { MAX_PASSES, resolveGenerateModel, DEFAULT_MODEL, STAGE_TIMEOUT_MS } from './config.ts';
import { runAgent, runShell } from './executor.ts';
import type { Finding, FindingsFile, Verdict } from './findings.ts';
import { openFindingIds, readFindings, syntheticFinding, writeFindings } from './findings.ts';
import { HARNESS_ROOT, type Programme } from './programme.ts';

export interface SliceState {
  slug: string;
  programme: string;
  status: 'running' | 'passed' | 'failed';
  passCount: number;
  verdicts: { pass: number; verdict: Verdict; stage: string; openFindingIds: string[] }[];
}

export const runsDir = (): string => join(HARNESS_ROOT, 'runs');
const sliceDir = (programme: string, slug: string): string => join(runsDir(), programme, slug);
const passDir = (programme: string, slug: string, pass: number): string =>
  join(sliceDir(programme, slug), `pass-${pass}`);

export function readState(programme: string, slug: string): SliceState | undefined {
  const path = join(sliceDir(programme, slug), 'state.json');
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as SliceState) : undefined;
}

function writeState(state: SliceState): void {
  const dir = sliceDir(state.programme, state.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'state.json'), JSON.stringify(state, null, 2) + '\n');
}

const prompt = (name: string): string => readFileSync(join(HARNESS_ROOT, 'prompts', `${name}.md`), 'utf8');

function paramsBlock(opts: { pass: number; spec: string; outDir: string; appLines: string[]; previous?: FindingsFile }): string {
  return [
    '\n\n## Run parameters (from the harness)\n',
    `- Pass: ${opts.pass} of ${MAX_PASSES}`,
    `- Workspace: your current directory`,
    `- Out directory: ${opts.outDir}`,
    opts.appLines.length
      ? `- Apps running (drive ALL of them):\n${opts.appLines.map((l) => `  - ${l}`).join('\n')}`
      : undefined,
    '\n## Spec\n',
    opts.spec,
    opts.previous ? `\n## Findings from the previous pass\n\n\`\`\`json\n${JSON.stringify(opts.previous, null, 2)}\n\`\`\`` : undefined,
  ]
    .filter((s) => s !== undefined)
    .join('\n');
}

/** Run one slice to PASS or MAX_PASSES. Resumes after the last recorded pass. */
export async function runSlice(programme: Programme, specPath: string, workspace: string): Promise<SliceState> {
  const slug = specPath.split('/').pop()!.replace(/\.md$/, '');
  const spec = readFileSync(specPath, 'utf8');
  const state: SliceState = readState(programme.name, slug) ?? {
    slug,
    programme: programme.name,
    status: 'running',
    passCount: 0,
    verdicts: [],
  };
  state.status = 'running';
  writeState(state);

  // Open-finding ids per prior pass, rebuilt from disk so escalation survives resume.
  const history: string[][] = [];
  for (let p = 1; p <= state.passCount; p++) {
    history.push(openFindingIds(readFindings(join(passDir(programme.name, slug, p), 'findings.json'))));
  }

  for (let pass = state.passCount + 1; pass <= MAX_PASSES; pass++) {
    const dir = passDir(programme.name, slug, pass);
    mkdirSync(dir, { recursive: true });
    const previous = pass > 1 ? readFindings(join(passDir(programme.name, slug, pass - 1), 'findings.json')) : undefined;

    const finish = (stage: string, verdict: Verdict, findings: Finding[]): boolean => {
      writeFindings(join(dir, 'findings.json'), { pass, verdict, findings });
      history.push(findings.filter((f) => f.status === 'open').map((f) => f.id));
      state.passCount = pass;
      state.verdicts.push({ pass, verdict, stage, openFindingIds: history[history.length - 1] });
      state.status = verdict === 'PASS' ? 'passed' : pass === MAX_PASSES ? 'failed' : 'running';
      writeState(state);
      return verdict === 'PASS';
    };

    // GENERATE
    const model = resolveGenerateModel(pass, history);
    console.log(`[${slug}] pass ${pass}/${MAX_PASSES}: GENERATE (${model})`);
    const gen = await runAgent({
      prompt: prompt('generator') + paramsBlock({ pass, spec, outDir: dir, appLines: [], previous }),
      model,
      workspace,
      outDir: dir,
      tracePath: join(dir, 'generate.jsonl'),
      timeoutMs: STAGE_TIMEOUT_MS,
    });
    if (gen.isError) {
      console.log(`[${slug}]   generator failed: ${gen.result.slice(0, 200)}`);
      if (finish('generate', 'FAIL', [syntheticFinding('Generator failed', gen.result)])) return state;
      continue;
    }

    // ASSERT — deterministic, no model, loops back without spending the Evaluator.
    const assertFindings: Finding[] = [];
    for (const rule of programme.asserts) {
      console.log(`[${slug}] pass ${pass}/${MAX_PASSES}: ASSERT ${rule.label}`);
      const res = await runShell(rule.command, workspace, STAGE_TIMEOUT_MS);
      if (!res.ok) assertFindings.push(syntheticFinding(`Assert failed: ${rule.label}`, `$ ${rule.command}\n${res.output}`));
    }
    if (assertFindings.length > 0) {
      console.log(`[${slug}]   ${assertFindings.length} assert(s) failed — looping`);
      if (finish('assert', 'FAIL', assertFindings)) return state;
      continue;
    }

    // SMOKE — boot every declared app; a dead app never reaches the Evaluator.
    const apps = await startApps(programme.apps, workspace);
    try {
      if (apps.failures.length > 0) {
        console.log(`[${slug}]   ${apps.failures.length} app(s) failed to boot — looping`);
        const findings = apps.failures.map((f) => syntheticFinding(`App failed to boot: ${f.label}`, f.detail));
        if (finish('smoke', 'FAIL', findings)) return state;
        continue;
      }

      // EVALUATE — the adversarial pass; writes findings.json (the verdict).
      console.log(`[${slug}] pass ${pass}/${MAX_PASSES}: EVALUATE (${DEFAULT_MODEL})`);
      const appLines = apps.running.map((a) => `${a.label}: ${a.url}`);
      const evalRes = await runAgent({
        prompt: prompt('evaluator') + paramsBlock({ pass, spec, outDir: dir, appLines, previous }),
        model: DEFAULT_MODEL,
        workspace,
        outDir: dir,
        tracePath: join(dir, 'evaluate.jsonl'),
        timeoutMs: STAGE_TIMEOUT_MS,
      });
      const written = readFindings(join(dir, 'findings.json'));
      if (evalRes.isError || !written) {
        const why = evalRes.isError ? evalRes.result : 'no valid findings.json written';
        console.log(`[${slug}]   evaluator failed: ${why.slice(0, 200)}`);
        if (finish('evaluate', 'FAIL', [syntheticFinding('Evaluator failed', why)])) return state;
        continue;
      }
      console.log(`[${slug}]   verdict: ${written.verdict} (${written.findings.length} finding(s))`);
      if (finish('evaluate', written.verdict, written.findings)) return state;
    } finally {
      apps.stopAll();
    }
  }
  return state;
}

/** Run a programme's specs strictly in order; a failed slice stops the ones after it. */
export async function runProgramme(programme: Programme): Promise<{ passed: string[]; failed: string[] }> {
  const workspace = join(runsDir(), programme.name, 'workspace');
  mkdirSync(workspace, { recursive: true });
  const passed: string[] = [];
  const failed: string[] = [];

  for (const specPath of programme.specs) {
    const slug = specPath.split('/').pop()!.replace(/\.md$/, '');
    if (readState(programme.name, slug)?.status === 'passed') {
      console.log(`[${slug}] already passed — skipping`);
      passed.push(slug);
      continue;
    }
    const state = await runSlice(programme, specPath, workspace);
    if (state.status === 'passed') {
      passed.push(slug);
    } else {
      console.log(`[${slug}] FAILED — stopping programme '${programme.name}' here`);
      failed.push(slug);
      break;
    }
  }
  return { passed, failed };
}
