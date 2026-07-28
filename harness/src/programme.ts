/**
 * Programme manifests: one YAML file per programme under programmes/, carrying everything
 * the harness needs to deliver it — ordered specs, optional apps to boot for evaluation,
 * and optional deterministic assert commands. The harness core knows nothing programme-
 * specific; add or change a programme by editing its manifest, not code.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

export const HARNESS_ROOT: string = join(import.meta.dirname, '..');

/** The repo root — also the base Next + Supabase scaffold every workspace is seeded from. */
export const PROJECT_ROOT: string = join(HARNESS_ROOT, '..');

export interface AppSpec {
  label: string;
  /** Shell command that boots the app; cwd is the repo root. */
  command: string;
  /** Port the app serves on; readiness = an HTTP response on it. */
  port: number;
}

export interface AssertSpec {
  label: string;
  /** Shell command run with the repo root as cwd; non-zero exit = finding. */
  command: string;
}

export interface Programme {
  name: string;
  /** Absolute spec paths, delivered strictly in order. */
  specs: string[];
  apps: AppSpec[];
  asserts: AssertSpec[];
}

export function listProgrammes(): string[] {
  const dir = join(HARNESS_ROOT, 'programmes');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => f.replace(/\.yaml$/, ''))
    .sort();
}

export function loadProgramme(name: string): Programme {
  const path = join(HARNESS_ROOT, 'programmes', `${name}.yaml`);
  if (!existsSync(path)) {
    throw new Error(`no programme '${name}' (${path}) — known: ${listProgrammes().join(', ') || '(none)'}`);
  }
  const raw = parse(readFileSync(path, 'utf8')) as Partial<Programme> | null;
  if (!raw || raw.name !== name) throw new Error(`${path}: 'name' must be '${name}'`);
  if (!Array.isArray(raw.specs) || raw.specs.length === 0) throw new Error(`${path}: 'specs' must be a non-empty list`);

  const specs = raw.specs.map((s) => {
    const p = join(HARNESS_ROOT, 'specs', String(s));
    if (!existsSync(p)) throw new Error(`${path}: spec not found: ${p}`);
    return p;
  });
  const apps = (raw.apps ?? []).map((a: Partial<AppSpec>, i: number) => {
    if (!a.label || !a.command || !a.port) throw new Error(`${path}: apps[${i}] needs label, command, port`);
    return { label: a.label, command: a.command, port: Number(a.port) };
  });
  const asserts = (raw.asserts ?? []).map((a: Partial<AssertSpec>, i: number) => {
    if (!a.label || !a.command) throw new Error(`${path}: asserts[${i}] needs label, command`);
    return { label: a.label, command: a.command };
  });
  return { name, specs, apps, asserts };
}
