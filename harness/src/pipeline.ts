/**
 * The pass loop. Per slice (one spec), each pass runs
 *
 *   GENERATE → ASSERT → SMOKE → EVALUATE
 *
 * where ASSERT (deterministic commands) and SMOKE (app boots) short-circuit back to
 * GENERATE with synthetic findings, never spending an Evaluator run on a broken build.
 * findings.json is the verdict; state.json is the resume/skip source of truth. Nothing in
 * a pass-N/ directory is ever overwritten — resuming continues at pass N+1.
 *
 * The repo itself is the workspace: it is already the Next + Supabase scaffold with
 * node_modules installed, so a programme gets a `factory/<name>` branch rather than a copy,
 * and every pass ends in a commit on it. Only run artifacts live under runs/.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEV_APP, startApps } from './apps.ts';
import { MAX_PASSES, resolveGenerateModel, DEFAULT_MODEL, STAGE_TIMEOUT_MS } from './config.ts';
import { runAgent, runShell, type AgentResult } from './executor.ts';
import type { Finding, FindingsFile, Verdict } from './findings.ts';
import { openFindingIds, readFindings, syntheticFinding, writeFindings } from './findings.ts';
import { HARNESS_ROOT, PROJECT_ROOT, type Programme } from './programme.ts';

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

/** Per-stage MCP server set — the Generator and the Evaluator get different ones. */
const mcpConfig = (stage: 'generator' | 'evaluator'): string => join(HARNESS_ROOT, 'mcp', `${stage}.json`);

/** A git command in the repo. Throws on non-zero exit. */
async function git(args: string): Promise<string> {
  const res = await runShell(`git ${args}`, PROJECT_ROOT, 60_000);
  if (!res.ok) throw new Error(`git ${args} failed:\n${res.output}`);
  return res.output.trim();
}

/**
 * Put the repo on this programme's branch. The repo *is* the workspace — it's already the Next
 * + Supabase scaffold with node_modules installed, so a programme needs a branch, not a copy.
 * An existing branch is resumed; otherwise it's cut from wherever HEAD is.
 */
async function checkoutProgrammeBranch(programmeName: string): Promise<string> {
  const branch = `factory/${programmeName}`;
  const exists = (await runShell(`git rev-parse --verify --quiet ${branch}`, PROJECT_ROOT, 60_000)).ok;
  await git(exists ? `checkout ${branch}` : `checkout -b ${branch}`);
  console.log(`[${programmeName}] branch ${branch}${exists ? ' (resuming)' : ' (new)'}`);
  return branch;
}

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

/**
 * Run one slice to PASS or MAX_PASSES. Resumes after the last recorded pass. `workspace` is
 * the repo root — the cwd every agent, assert and app runs in.
 */
export async function runSlice(programme: Programme, specPath: string, workspace: string): Promise<SliceState> {
  const slug = specPath.split('/').pop()!.replace(/\.md$/, '');
  const spec = readFileSync(specPath, 'utf8');
  const appSpecs = [DEV_APP, ...programme.apps];
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

    const finish = async (stage: string, verdict: Verdict, findings: Finding[]): Promise<boolean> => {
      writeFindings(join(dir, 'findings.json'), { pass, verdict, findings });
      history.push(findings.filter((f) => f.status === 'open').map((f) => f.id));
      state.passCount = pass;
      state.verdicts.push({ pass, verdict, stage, openFindingIds: history[history.length - 1] });
      state.status = verdict === 'PASS' ? 'passed' : pass === MAX_PASSES ? 'failed' : 'running';
      writeState(state);
      // One commit per pass, on the programme's branch. This is what makes the branch mean
      // anything: each pass is a reviewable diff, and the next programme can start from a
      // clean tree instead of inheriting this one's uncommitted edits.
      await git('add -A');
      if ((await runShell('git diff --cached --quiet', PROJECT_ROOT, 60_000)).ok) {
        console.log(`[${slug}]   nothing to commit for pass ${pass}`);
      } else {
        await git(`commit -m "factory(${programme.name}/${slug}): pass ${pass} ${verdict} @ ${stage}"`);
      }
      return verdict === 'PASS';
    };

    // GENERATE — apps come up first. `claude` connects to its MCP servers when it spawns, so
    // an HTTP one (nextjs, supabase) that starts mid-turn is never seen; the Generator only
    // gets the nextjs tools if the dev server is already listening. Best effort: a workspace
    // too broken to boot is precisely what the Generator is here to fix, so a failure here is
    // logged, not fatal — SMOKE is where a dead app becomes a finding.
    const genApps = await startApps(appSpecs, workspace);
    if (genApps.failures.length > 0) {
      const labels = genApps.failures.map((f) => f.label).join(', ');
      console.log(`[${slug}]   ${labels} not up for GENERATE — continuing without its MCP tools`);
    }
    const model = resolveGenerateModel(pass, history);
    console.log(`[${slug}] pass ${pass}/${MAX_PASSES}: GENERATE (${model})`);
    let gen: AgentResult;
    try {
      gen = await runAgent({
        prompt: prompt('generator') + paramsBlock({ pass, spec, outDir: dir, appLines: genApps.running.map((a) => `${a.label}: ${a.url}`), previous }),
        model,
        workspace,
        outDir: dir,
        tracePath: join(dir, 'generate.jsonl'),
        mcpConfig: mcpConfig('generator'),
        timeoutMs: STAGE_TIMEOUT_MS,
      });
    } finally {
      // Stopped before ASSERT: `next build` cannot take .next/lock while a dev server holds it.
      genApps.stopAll();
    }
    if (gen.isError) {
      console.log(`[${slug}]   generator failed: ${gen.result.slice(0, 200)}`);
      if (await finish('generate', 'FAIL', [syntheticFinding('Generator failed', gen.result)])) return state;
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
      if (await finish('assert', 'FAIL', assertFindings)) return state;
      continue;
    }

    // SMOKE — reboot every app against the code the Generator just wrote (and the deps ASSERT
    // just installed); a dead app never reaches the Evaluator.
    const apps = await startApps(appSpecs, workspace);
    try {
      if (apps.failures.length > 0) {
        console.log(`[${slug}]   ${apps.failures.length} app(s) failed to boot — looping`);
        const findings = apps.failures.map((f) => syntheticFinding(`App failed to boot: ${f.label}`, f.detail));
        if (await finish('smoke', 'FAIL', findings)) return state;
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
        mcpConfig: mcpConfig('evaluator'),
        timeoutMs: STAGE_TIMEOUT_MS,
      });
      const written = readFindings(join(dir, 'findings.json'));
      if (evalRes.isError || !written) {
        const why = evalRes.isError ? evalRes.result : 'no valid findings.json written';
        console.log(`[${slug}]   evaluator failed: ${why.slice(0, 200)}`);
        if (await finish('evaluate', 'FAIL', [syntheticFinding('Evaluator failed', why)])) return state;
        continue;
      }
      console.log(`[${slug}]   verdict: ${written.verdict} (${written.findings.length} finding(s))`);
      if (await finish('evaluate', written.verdict, written.findings)) return state;
    } finally {
      apps.stopAll();
    }
  }
  return state;
}

/** Run a programme's specs strictly in order; a failed slice stops the ones after it. */
export async function runProgramme(programme: Programme): Promise<{ passed: string[]; failed: string[] }> {
  await checkoutProgrammeBranch(programme.name);
  const passed: string[] = [];
  const failed: string[] = [];

  for (const specPath of programme.specs) {
    const slug = specPath.split('/').pop()!.replace(/\.md$/, '');
    if (readState(programme.name, slug)?.status === 'passed') {
      console.log(`[${slug}] already passed — skipping`);
      passed.push(slug);
      continue;
    }
    const state = await runSlice(programme, specPath, PROJECT_ROOT);
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
