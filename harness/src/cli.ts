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
import { join } from 'node:path';
import { authEnvName } from './config.ts';
import { readState, runProgramme, runsDir } from './pipeline.ts';
import { listProgrammes, loadProgramme } from './programme.ts';

const sh = (cmd: string, args: string[]): boolean => spawnSync(cmd, args, { stdio: 'ignore' }).status === 0;
/** `command -v <bin>` is a bash builtin, not always a standalone binary on PATH — run it through bash. */
const onPath = (bin: string): boolean => sh('bash', ['-lc', `command -v ${bin}`]);

function doctor(): number {
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
  check(true, Boolean(authEnvName()), 'agent auth env', "export CLAUDE_CODE_OAUTH_TOKEN (from 'claude setup-token') or ANTHROPIC_API_KEY");
  console.log(ok ? '==> ready' : '==> fix the ✗ items above');
  return ok ? 0 : 1;
}

function status(): void {
  const dir = runsDir();
  const rows: string[][] = [];
  for (const programme of existsSync(dir) ? readdirSync(dir).sort() : []) {
    const progDir = join(dir, programme);
    if (!existsSync(join(progDir, 'workspace'))) continue;
    for (const slug of readdirSync(progDir).filter((d) => d !== 'workspace').sort()) {
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
  if (!authEnvName()) {
    console.error("error: export CLAUDE_CODE_OAUTH_TOKEN (from 'claude setup-token') or ANTHROPIC_API_KEY");
    return 1;
  }
  const programmes = names.map(loadProgramme); // fail fast on any bad manifest
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
    process.exitCode = doctor();
    break;
  case 'clean':
    rmSync(runsDir(), { recursive: true, force: true });
    console.log('runs deleted');
    break;
  default:
    usage();
    process.exitCode = cmd === undefined || cmd === 'help' ? 0 : 1;
}
