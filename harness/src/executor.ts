/**
 * Everything that spawns a stage as a direct host child process: agent runs (`claude -p`,
 * full stream-json trace kept), one-shot shell commands (asserts), and detached app
 * processes. Nothing is containerized — the host (or the disposable VM you run the harness
 * in) is the safety boundary. Agents run with permissions skipped and full host access.
 */

import { spawn } from 'node:child_process';
import { createWriteStream, openSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let seq = 0;
export const uniqueName = (kind: string): string => `harness-${kind}-${process.pid}-${++seq}`;

/** Log file a detached app writes its stdout/stderr to, keyed by the app's name. */
const appLogPath = (name: string): string => join(tmpdir(), `${name}.log`);

/** pid of each detached app, keyed by name, so we can signal/kill it later. */
const appPids = new Map<string, number>();

interface Collected {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Spawn a command, kill it on timeout, collect output. */
function collect(
  command: string,
  args: string[],
  opts: { timeoutMs: number; cwd?: string; onStdoutLine?: (line: string) => void }
): Promise<Collected> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd: opts.cwd });
    let stdout = '';
    let stderr = '';
    let pending = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, opts.timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      if (opts.onStdoutLine) {
        pending += text;
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';
        for (const line of lines) opts.onStdoutLine(line);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: `${stderr}\n${err.message}`, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (pending && opts.onStdoutLine) opts.onStdoutLine(pending);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

export interface AgentResult {
  isError: boolean;
  /** The agent's final text, or an error description. */
  result: string;
  costUsd?: number;
  numTurns?: number;
}

export interface AgentRequest {
  prompt: string;
  model: string;
  /** Host dir the agent runs in (its cwd). */
  workspace: string;
  /** Host dir where the Evaluator writes findings.json. */
  outDir: string;
  /** Host path the full stream-json trace is written to. */
  tracePath: string;
  /**
   * Path to this stage's MCP server set. Passed with --strict-mcp-config so the repo's own
   * .mcp.json never leaks in — that is the only thing keeping playwright out of the Generator.
   */
  mcpConfig: string;
  timeoutMs: number;
}

/** Run one agent stage as a host process, teeing the full agentic trace to disk. */
export async function runAgent(req: AgentRequest): Promise<AgentResult> {
  const trace = createWriteStream(req.tracePath);
  let final: { is_error?: boolean; result?: string; total_cost_usd?: number; num_turns?: number } | undefined;

  const { code, stderr, timedOut } = await collect(
    'claude',
    [
      '-p', req.prompt, '--model', req.model,
      '--mcp-config', req.mcpConfig, '--strict-mcp-config',
      '--dangerously-skip-permissions', '--verbose', '--output-format', 'stream-json',
    ],
    {
      timeoutMs: req.timeoutMs,
      cwd: req.workspace,
      onStdoutLine: (line) => {
        trace.write(line + '\n');
        try {
          const event = JSON.parse(line) as { type?: string };
          if (event.type === 'result') final = event as typeof final;
        } catch {
          /* progress noise, not an event */
        }
      },
    }
  );
  trace.end();

  if (timedOut) return { isError: true, result: `stage timed out after ${req.timeoutMs / 1000}s` };
  if (final) {
    return {
      isError: Boolean(final.is_error) || code !== 0,
      result: final.result ?? '',
      costUsd: final.total_cost_usd,
      numTurns: final.num_turns,
    };
  }
  return { isError: true, result: `agent produced no result event (exit ${code}): ${stderr.slice(-1500)}` };
}

/** Run a one-shot shell command in the workspace. */
export async function runShell(
  command: string,
  workspace: string,
  timeoutMs: number
): Promise<{ ok: boolean; output: string }> {
  const { code, stdout, stderr, timedOut } = await collect('bash', ['-lc', command], {
    timeoutMs,
    cwd: workspace,
  });
  const combined = `${stdout}${stderr}`;
  const output = timedOut ? `(timed out after ${timeoutMs / 1000}s)\n${combined}` : combined;
  return { ok: !timedOut && code === 0, output };
}

/**
 * Start a detached app process and return its name. Its stdout/stderr go to a log file
 * (see {@link appLogTail}) so a crashed app stays inspectable; teardown is {@link stopApp}'s job.
 */
export async function startDetached(command: string, workspace: string): Promise<{ name?: string; error?: string }> {
  const name = uniqueName('app');
  try {
    const log = openSync(appLogPath(name), 'w');
    const child = spawn('bash', ['-lc', command], {
      cwd: workspace,
      detached: true,
      stdio: ['ignore', log, log],
    });
    if (child.pid === undefined) return { error: 'failed to spawn app process' };
    appPids.set(name, child.pid);
    child.unref();
    return { name };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Stop an app started by {@link startDetached}. Signals the whole process *group* (negative
 * pid — the child is spawned detached, so it leads its own group): `bash -lc "npm run dev"`
 * puts the real server two levels down, and killing only the wrapper would orphan it still
 * holding the port, so the next pass's boot would hit EADDRINUSE.
 */
export function stopApp(name: string): void {
  const pid = appPids.get(name);
  if (pid === undefined) return;
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    /* already gone */
  }
  appPids.delete(name);
}

/** Whether anything in the app's process group is still running (a crashed app stops being). */
export const appRunning = async (name: string): Promise<boolean> => {
  const pid = appPids.get(name);
  if (pid === undefined) return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** The last `lines` lines of an app's log file. */
export async function appLogTail(name: string, lines: number): Promise<string> {
  try {
    return readFileSync(appLogPath(name), 'utf8').split('\n').slice(-lines).join('\n');
  } catch {
    return '';
  }
}
