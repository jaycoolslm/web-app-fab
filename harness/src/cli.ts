/**
 * factory — config-driven agent harness that runs each stage as a direct host process.
 *
 *   factory run <programme...>   deliver each programme's specs in order
 *   factory status               every slice's state across all programmes
 *   factory doctor               check requirements, print the fix for anything missing
 *   factory clean                delete all runs
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEV_PORT, hasAuthEnvVar, SUPABASE_MCP_URL } from './config.ts';
import { runShell } from './executor.ts';
import { readState, runProgramme, runsDir } from './pipeline.ts';
import { listProgrammes, loadProgramme, PROJECT_ROOT } from './programme.ts';

const sh = (cmd: string, args: string[]): boolean => spawnSync(cmd, args, { stdio: 'ignore' }).status === 0;
/** `command -v <bin>` is a bash builtin, not always a standalone binary on PATH — run it through bash. */
const onPath = (bin: string): boolean => sh('bash', ['-lc', `command -v ${bin}`]);

/** Something is listening and speaking HTTP. Any status counts; only a refused connection is down. */
const httpUp = async (url: string): Promise<boolean> => {
  try {
    await fetch(url, { signal: AbortSignal.timeout(3000) });
    return true;
  } catch {
    return false;
  }
};

/** Whether we could bind the port ourselves — the only reliable "is it free" test. */
const portFree = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });

/**
 * Whether `playwright install chromium` has already put a browser in the cache both Evaluators
 * drive. Not run-blocking — the playwright MCP server downloads one on demand — but that
 * download lands mid-pass, on the clock, in a programme meant to run unattended for hours, so
 * doctor says so up front. PLAYWRIGHT_BROWSERS_PATH wins here exactly as it does for Playwright.
 */
function chromiumInstalled(): boolean {
  const fromEnv = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const dir =
    fromEnv ??
    (process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Caches', 'ms-playwright')
      : process.platform === 'win32'
        ? join(homedir(), 'AppData', 'Local', 'ms-playwright')
        : join(homedir(), '.cache', 'ms-playwright'));
  return existsSync(dir) && readdirSync(dir).some((entry) => entry.startsWith('chromium'));
}

/**
 * The services that must be up (and the port that must be ours) before a run starts, checked
 * by both `doctor` and `run`. Supabase because the agents' MCP config points at it; port
 * {@link DEV_PORT} because the harness boots the workspace's dev server there — if your own
 * `npm run dev` already holds it, the agents would silently drive that app instead.
 */
async function serviceChecks(): Promise<{ passed: boolean; label: string; fix: string }[]> {
  const gitStatus = await runShell('git status --porcelain', PROJECT_ROOT, 60_000);
  return [
    {
      passed: await httpUp(SUPABASE_MCP_URL),
      label: 'supabase up (54321)',
      fix: 'npx supabase start',
    },
    {
      passed: await portFree(DEV_PORT),
      label: `port ${DEV_PORT} free`,
      fix: `stop whatever holds it (your own 'npm run dev'?) — the harness needs ${DEV_PORT} for the app`,
    },
    {
      passed: gitStatus.ok && gitStatus.output.trim() === '',
      label: 'git tree clean',
      fix: 'commit or stash first — the harness builds in this repo, on a factory/<programme> branch',
    },
  ];
}

async function doctor(): Promise<number> {
  let ok = true;
  const check = (hard: boolean, passed: boolean, label: string, fix: string): void => {
    if (passed) console.log(`  ✓ ${label}`);
    else {
      if (hard) ok = false;
      console.log(`  ${hard ? '✗' : '-'} ${label.padEnd(32)} fix: ${fix}`);
    }
  };
  check(true, sh('bash', ['--version']), 'bash on PATH', 'install bash (on Windows: Git for Windows / Git Bash)');
  check(true, onPath('claude'), 'claude CLI on PATH', 'https://docs.claude.com/claude-code');
  check(
    false,
    hasAuthEnvVar(),
    'auth env var set',
    "optional — 'claude login' works fine too; export CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY only if you want key-based auth"
  );
  check(
    false,
    chromiumInstalled(),
    'playwright chromium installed',
    'npx playwright install chromium — otherwise the first Evaluator pays for the download mid-run'
  );
  for (const c of await serviceChecks()) check(true, c.passed, c.label, c.fix);
  console.log(ok ? '==> ready' : '==> fix the ✗ items above');
  return ok ? 0 : 1;
}

function status(): void {
  const dir = runsDir();
  const rows: string[][] = [];
  for (const programme of existsSync(dir) ? readdirSync(dir).sort() : []) {
    const progDir = join(dir, programme);
    for (const slug of readdirSync(progDir).sort()) {
      const s = readState(programme, slug);
      const last = s?.verdicts[s.verdicts.length - 1];
      rows.push([programme, slug, s?.status ?? '?', String(s?.passCount ?? 0), last ? `${last.verdict} @ ${last.stage}` : '-']);
    }
  }
  if (rows.length === 0) return console.log('no runs yet');
  const header = ['programme', 'slice', 'status', 'passes', 'last verdict'];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cols: string[]) => cols.map((c, i) => c.padEnd(widths[i])).join('  ');
  console.log(line(header));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  rows.forEach((r) => console.log(line(r)));
}

async function run(names: string[]): Promise<number> {
  if (names.length === 0) {
    console.error(`usage: factory run <programme...> — known: ${listProgrammes().join(', ') || '(none)'}`);
    return 1;
  }
  const programmes = names.map(loadProgramme); // fail fast on any bad manifest

  // Preflight: the agents' MCP servers are HTTP endpoints they connect to at spawn, so the
  // services behind them have to be up before the first Generator starts, not after.
  const failures = (await serviceChecks()).filter((c) => !c.passed);
  if (failures.length > 0) {
    for (const f of failures) console.error(`  ✗ ${f.label.padEnd(32)} fix: ${f.fix}`);
    console.error('==> not starting; the agents need these before GENERATE');
    return 1;
  }

  let failed = false;
  for (const programme of programmes) {
    const result = await runProgramme(programme);
    console.log(`==> ${programme.name}: ${result.passed.length} passed, ${result.failed.length} failed`);
    if (result.failed.length > 0) failed = true;
  }
  return failed ? 1 : 0;
}

const usage = (): void =>
  console.log(
    [
      'factory — config-driven agent harness that runs each stage as a direct host process',
      '',
      '  factory run <programme...>   deliver each programme\'s specs in order',
      '  factory status               every slice\'s state across all programmes',
      '  factory doctor               check requirements, print fixes',
      '  factory clean                delete all runs',
    ].join('\n')
  );

const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
  case 'run':
    process.exitCode = await run(rest);
    break;
  case 'status':
    status();
    break;
  case 'doctor':
    process.exitCode = await doctor();
    break;
  case 'clean':
    rmSync(runsDir(), { recursive: true, force: true });
    console.log('runs deleted');
    break;
  default:
    usage();
    process.exitCode = cmd === undefined || cmd === 'help' ? 0 : 1;
}
