/**
 * Static policy: pass/timeout limits and the model-tiering policy.
 * Everything programme-specific lives in programmes/<name>.yaml, not here.
 */

const int = (v: string | undefined, fallback: number): number => (v ? Number(v) : fallback);

/** Max generate→evaluate passes per slice before giving up. */
export const MAX_PASSES: number = int(process.env.HARNESS_MAX_PASSES, 3);

/** Per-stage wall clock, seconds. A hung agent is killed, not waited on. */
export const STAGE_TIMEOUT_MS: number = int(process.env.HARNESS_STAGE_TIMEOUT_S, 1800) * 1000;

/**
 * Wall clock for EVALUATE_UX, seconds. Deliberately shorter than the full stage budget: it is a
 * fifth stage on every pass of a programme meant to run unattended for hours, and a bounded
 * screenshot rubric is not the same amount of work as judging correctness.
 */
export const UX_STAGE_TIMEOUT_MS: number = int(process.env.HARNESS_UX_STAGE_TIMEOUT_S, 900) * 1000;

/** How long an app gets to answer HTTP after boot. */
export const APP_READY_TIMEOUT_MS: number = int(process.env.HARNESS_APP_READY_S, 90) * 1000;

/**
 * Port the workspace's Next dev server listens on. Not configurable per programme: the MCP
 * server sets in mcp/*.json name this port literally (`localhost:3000/_next/mcp`), so the two
 * would silently diverge. The harness owns it for the length of a run — see the `run` preflight.
 */
export const DEV_PORT = 3000;

/** Local Supabase's MCP endpoint, from `npx supabase start`. Checked by doctor and the preflight. */
export const SUPABASE_MCP_URL = 'http://localhost:54321/mcp';

/** Model for pass 1 and for the Evaluator. */
export const DEFAULT_MODEL: string = process.env.HARNESS_MODEL ?? 'claude-opus-5';

/** Cheaper model for Generator fix passes (pass ≥ 2). */
export const FIX_MODEL: string = process.env.HARNESS_FIX_MODEL ?? 'claude-sonnet-5';

/**
 * Whether an API-key-style auth env var is set. Optional: `claude` also works off a local
 * `claude login` session with neither of these set, since it runs as a direct host process now.
 */
export function hasAuthEnvVar(): boolean {
  return Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY);
}

/**
 * Generator model for a pass. Pass 1 gets the default model; fix passes get the cheap
 * model, escalating back to the default when any still-open finding id has already
 * appeared in two or more prior passes (i.e. a fix attempt failed to clear it).
 *
 * The caller passes `escalationHistory(...)`, not the raw history: UX ids are filtered out
 * because a vision model naming different cosmetic nits each pass would churn the id set and
 * escalate on noise rather than on a fix that genuinely failed.
 */
export function resolveGenerateModel(pass: number, findingsHistory: string[][]): string {
  if (pass <= 1) return DEFAULT_MODEL;
  const openIds = findingsHistory[findingsHistory.length - 1] ?? [];
  const survivedTwice = openIds.some((id) => findingsHistory.filter((ids) => ids.includes(id)).length >= 2);
  return survivedTwice ? DEFAULT_MODEL : FIX_MODEL;
}
