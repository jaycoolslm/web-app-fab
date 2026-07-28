/**
 * Shared incident vocabulary. These lists mirror the CHECK constraints in
 * `supabase/migrations/*_incident_desk_foundation.sql` — the database is the
 * authority, this is just the UI's copy of it.
 */

export const SEVERITIES = ["P1", "P2", "P3", "P4"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const STATUSES = [
  "triage",
  "investigating",
  "mitigating",
  "resolved",
] as const;
export type IncidentStatus = (typeof STATUSES)[number];

export const SEVERITY_LABELS: Record<Severity, string> = {
  P1: "P1 — Critical",
  P2: "P2 — Major",
  P3: "P3 — Minor",
  P4: "P4 — Low",
};

export const STATUS_LABELS: Record<IncidentStatus, string> = {
  triage: "Triage",
  investigating: "Investigating",
  mitigating: "Mitigating",
  resolved: "Resolved",
};

export function isSeverity(value: unknown): value is Severity {
  return SEVERITIES.includes(value as Severity);
}

export function isStatus(value: unknown): value is IncidentStatus {
  return STATUSES.includes(value as IncidentStatus);
}

export type Incident = {
  id: string;
  team_id: string;
  title: string;
  description: string;
  severity: Severity;
  status: IncidentStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type Team = {
  id: string;
  name: string;
};

/**
 * Form state for the create action. It lives here rather than beside the
 * action because a `"use server"` module may only export async functions.
 */
export type CreateIncidentState = {
  error: string | null;
  /** Bumped on every success so the client can clear the form. */
  createdCount: number;
};

export const initialCreateIncidentState: CreateIncidentState = {
  error: null,
  createdCount: 0,
};

/** Tailwind classes for the severity chip. P1 should read as an alarm. */
export const SEVERITY_CHIP_CLASS: Record<Severity, string> = {
  P1: "border-transparent bg-red-600 text-white",
  P2: "border-transparent bg-orange-500 text-white",
  P3: "border-transparent bg-amber-400 text-amber-950",
  P4: "border-transparent bg-slate-500 text-white",
};

export const STATUS_CHIP_CLASS: Record<IncidentStatus, string> = {
  triage: "border-foreground/20 text-foreground",
  investigating: "border-transparent bg-blue-600 text-white",
  mitigating: "border-transparent bg-violet-600 text-white",
  resolved: "border-transparent bg-emerald-600 text-white",
};
