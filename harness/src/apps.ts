/**
 * SMOKE-stage app lifecycle: boot each app the programme declares as its own detached
 * host process (from the shared workspace), wait for it to answer HTTP, and hand the
 * Evaluator the localhost URLs. A boot failure becomes a synthetic finding upstream.
 */

import { APP_READY_TIMEOUT_MS } from './config.ts';
import { appLogTail, appRunning, startDetached, stopApp } from './executor.ts';
import type { AppSpec } from './programme.ts';

export interface RunningApp {
  label: string;
  appName: string;
  /** Reachable from the host (and the Evaluator) at localhost. */
  url: string;
}

export interface AppsResult {
  running: RunningApp[];
  failures: { label: string; detail: string }[];
  stopAll: () => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll until the app answers HTTP, it dies, or the deadline passes. */
async function waitForHttp(url: string, appName: string, deadlineMs: number): Promise<'up' | 'died' | 'timeout'> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(3000) });
      return 'up'; // any HTTP response counts as up; correctness is the Evaluator's job
    } catch {
      if (!(await appRunning(appName))) return 'died';
      await sleep(1500);
    }
  }
  return 'timeout';
}

export async function startApps(apps: AppSpec[], workspace: string): Promise<AppsResult> {
  const running: RunningApp[] = [];
  const failures: { label: string; detail: string }[] = [];
  const stopAll = () => running.forEach((app) => stopApp(app.appName));

  for (const app of apps) {
    const started = await startDetached(app.command, workspace);
    if (!started.name) {
      failures.push({ label: app.label, detail: `app failed to start: ${started.error}` });
      continue;
    }
    const url = `http://localhost:${app.port}`;
    const outcome = await waitForHttp(url, started.name, APP_READY_TIMEOUT_MS);
    if (outcome === 'up') {
      running.push({ label: app.label, appName: started.name, url });
    } else {
      const tail = await appLogTail(started.name, 40);
      stopApp(started.name);
      const why =
        outcome === 'died'
          ? 'app process exited'
          : `no HTTP response on ${url} within ${APP_READY_TIMEOUT_MS / 1000}s`;
      failures.push({ label: app.label, detail: `${why}; last log lines:\n${tail}` });
    }
  }
  return { running, failures, stopAll };
}
