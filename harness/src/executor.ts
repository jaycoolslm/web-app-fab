/**
 * Everything that touches the Apple `container` CLI: agent runs (`claude -p` inside a
 * micro-VM, full stream-json trace kept), one-shot shell commands (asserts), and detached
 * app containers. The VM is the safety boundary — agents run with permissions skipped but
 * see only /workspace and /out.
 */

import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { authEnvName, IMAGE } from './config.ts';

let seq = 0;
export const uniqueName = (kind: string): string => `harness-${kind}-${process.pid}-${++seq}`;

export function stopContainer(name: string): void {
  spawn('container', ['stop', name], { stdio: 'ignore' });
}

/** Drop the container CLI's boot-progress lines ("[3/6] Fetching kernel …"). */
const stripProgress = (s: string): string =>
  s
    .split('\n')
    .filter((l) => !/^\[\d\/\d\]/.test(l))
    .join('\n');

interface Collected {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Spawn `container <args>`, kill the named container on timeout, collect output. */
function collect(
  args: string[],
  opts: { timeoutMs: number; killName?: string; onStdoutLine?: (line: string) => void }
): Promise<Collected> {
  return new Promise((resolve) => {
    const child = spawn('container', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let pending = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (opts.killName) stopContainer(opts.killName);
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
  /** Host dir mounted read-write at /workspace (the agent's cwd). */
  workspace: string;
  /** Host dir mounted read-write at /out (where the Evaluator writes findings.json). */
  outDir: string;
  /** Host path the full stream-json trace is written to. */
  tracePath: string;
  timeoutMs: number;
}

/** Run one agent stage in a fresh micro-VM, teeing the full agentic trace to disk. */
export async function runAgent(req: AgentRequest): Promise<AgentResult> {
  const auth = authEnvName();
  if (!auth) return { isError: true, result: 'no CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY in the environment' };
  const name = uniqueName('agent');
  const trace = createWriteStream(req.tracePath);
  let final: { is_error?: boolean; result?: string; total_cost_usd?: number; num_turns?: number } | undefined;

  const { code, stderr, timedOut } = await collect(
    [
      'run', '--rm', '--name', name,
      '--mount', `type=bind,source=${req.workspace},target=/workspace`,
      '--mount', `type=bind,source=${req.outDir},target=/out`,
      '--env', auth, '--env', 'IS_SANDBOX=1',
      IMAGE,
      'claude', '-p', req.prompt, '--model', req.model,
      '--dangerously-skip-permissions', '--verbose', '--output-format', 'stream-json',
    ],
    {
      timeoutMs: req.timeoutMs,
      killName: name,
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

/** Run a one-shot shell command inside a container with the workspace mounted. */
export async function runShell(
  command: string,
  workspace: string,
  timeoutMs: number
): Promise<{ ok: boolean; output: string }> {
  const name = uniqueName('shell');
  const { code, stdout, stderr, timedOut } = await collect(
    [
      'run', '--rm', '--name', name,
      '--mount', `type=bind,source=${workspace},target=/workspace`,
      IMAGE, 'bash', '-lc', `cd /workspace && { ${command}; }`,
    ],
    { timeoutMs, killName: name }
  );
  const combined = stripProgress(`${stdout}${stderr}`);
  const output = timedOut ? `(timed out after ${timeoutMs / 1000}s)\n${combined}` : combined;
  return { ok: !timedOut && code === 0, output };
}

/**
 * Start a detached container and return its name. Deliberately not `--rm`: a crashed app
 * must stay inspectable for its log tail; removal is {@link removeContainer}'s job.
 */
export async function startDetached(command: string, workspace: string): Promise<{ name?: string; error?: string }> {
  const name = uniqueName('app');
  const { code, stderr } = await collect(
    [
      'run', '--detach', '--name', name,
      '--mount', `type=bind,source=${workspace},target=/workspace`,
      IMAGE, 'bash', '-lc', `cd /workspace && { ${command}; }`,
    ],
    { timeoutMs: 60_000, killName: name }
  );
  if (code !== 0) return { error: stripProgress(stderr).slice(-1500) };
  return { name };
}

/** Stop (if needed) and delete a container started by {@link startDetached}. */
export function removeContainer(name: string): void {
  const child = spawn('sh', ['-c', `container stop '${name}'; container delete --force '${name}'`], {
    stdio: 'ignore',
  });
  child.unref();
}

async function inspectStatus(name: string): Promise<{ state?: string; ip?: string }> {
  const { code, stdout } = await collect(['inspect', name], { timeoutMs: 10_000 });
  if (code !== 0) return {};
  try {
    const parsed = JSON.parse(stdout) as [{ status?: { state?: string; networks?: { ipv4Address?: string }[] } }];
    return { state: parsed[0]?.status?.state, ip: parsed[0]?.status?.networks?.[0]?.ipv4Address?.split('/')[0] };
  } catch {
    return {};
  }
}

/** The container's IPv4 address, from `container inspect`. */
export const containerIp = async (name: string): Promise<string | undefined> => (await inspectStatus(name)).ip;

/** Whether the container is still running (a crashed app stops being). */
export const containerRunning = async (name: string): Promise<boolean> =>
  (await inspectStatus(name)).state === 'running';

/** The last `lines` lines of a container's log. */
export async function containerLogTail(name: string, lines: number): Promise<string> {
  const { stdout, stderr } = await collect(['logs', name], { timeoutMs: 10_000 });
  return (stdout + stderr).split('\n').slice(-lines).join('\n');
}
