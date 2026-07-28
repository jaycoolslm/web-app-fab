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
  assignee_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type Team = {
  id: string;
  name: string;
};

/**
 * A member of the viewer's own team, as read from the `team_directory` view.
 * The view is `security_invoker`, so this can only ever describe teammates.
 */
export type TeamMember = {
  user_id: string;
  display_name: string;
  email: string | null;
};

/** What the UI says where a name would go and there is nobody to name. */
export const UNASSIGNED_LABEL = "Unassigned";

/**
 * The name to show for an assignee. `people` is the viewer's own team, so a
 * miss means the assignee is no longer on it — which the composite foreign key
 * makes transient, but a page rendered mid-change should still say something.
 */
export function assigneeName(
  assigneeId: string | null,
  people: Map<string, TeamMember>,
): string | null {
  if (!assigneeId) return null;
  return people.get(assigneeId)?.display_name ?? "Someone on your team";
}

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

/**
 * Accent stripe down the left edge of a board card. P1 gets a saturated red
 * bar so a critical incident is identifiable without reading the chip.
 */
export const SEVERITY_ACCENT_CLASS: Record<Severity, string> = {
  P1: "border-l-red-600",
  P2: "border-l-orange-500",
  P3: "border-l-amber-400",
  P4: "border-l-slate-400",
};

/** Column tint, so the four board columns are distinguishable at a glance. */
export const STATUS_ACCENT_CLASS: Record<IncidentStatus, string> = {
  triage: "bg-foreground/[0.04]",
  investigating: "bg-blue-500/[0.07]",
  mitigating: "bg-violet-500/[0.07]",
  resolved: "bg-emerald-500/[0.07]",
};

// ---------------------------------------------------------------------------
// Board ordering and column arithmetic
// ---------------------------------------------------------------------------

/** SEVERITIES is already worst-first, so its index is the sort rank. */
export function severityRank(severity: Severity): number {
  return SEVERITIES.indexOf(severity);
}

/** The subset of an incident a board card needs. */
export type BoardCard = Pick<
  Incident,
  "id" | "title" | "severity" | "status" | "assignee_id" | "created_at"
>;

/**
 * Board order within a column: worst severity first, then most recently raised.
 * The server query sorts the same way, but a card that moves column has to be
 * re-placed on the client without waiting for a round trip.
 */
export function compareForBoard(a: BoardCard, b: BoardCard): number {
  const bySeverity = severityRank(a.severity) - severityRank(b.severity);
  if (bySeverity !== 0) return bySeverity;
  return b.created_at.localeCompare(a.created_at);
}

/** The column to the left of `status`, or null if it is already the first. */
export function previousStatus(status: IncidentStatus): IncidentStatus | null {
  return STATUSES[STATUSES.indexOf(status) - 1] ?? null;
}

/** The column to the right of `status`, or null if it is already the last. */
export function nextStatus(status: IncidentStatus): IncidentStatus | null {
  return STATUSES[STATUSES.indexOf(status) + 1] ?? null;
}

/**
 * What the drop handler reports back to the board. A refusal is a value, not a
 * thrown error, because the board has to put the card back and explain why.
 */
export type MoveIncidentResult =
  | { ok: true; status: IncidentStatus }
  | { ok: false; error: string };

/** Same contract for the assignment picker: a refusal is a value with a reason. */
export type AssignIncidentResult =
  | { ok: true; assigneeId: string | null }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Activity trail
// ---------------------------------------------------------------------------

export const EVENT_KINDS = [
  "raised",
  "status_changed",
  "assignment_changed",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/**
 * One row of `incident_events`. The `*_name` fields are captured by the trigger
 * at write time, so a trail entry still reads correctly after the person it
 * names has left the team.
 */
export type IncidentEvent = {
  id: string;
  seq: number;
  incident_id: string;
  kind: EventKind;
  actor_id: string | null;
  actor_name: string;
  from_status: IncidentStatus | null;
  to_status: IncidentStatus | null;
  from_assignee_id: string | null;
  from_assignee_name: string | null;
  to_assignee_id: string | null;
  to_assignee_name: string | null;
  created_at: string;
};

/**
 * The trail entry as a sentence. Deliberately not a field-by-field diff: the
 * point of the trail is that somebody skimming it understands what happened
 * without decoding it.
 *
 * `viewerId` turns the reader's own actions into "You", which is how people
 * actually read a shared log.
 */
export function describeEvent(
  event: IncidentEvent,
  viewerId: string | null,
): string {
  const isViewer = viewerId !== null && event.actor_id === viewerId;
  const who = isViewer ? "You" : event.actor_name;

  switch (event.kind) {
    case "raised": {
      const status = event.to_status ? STATUS_LABELS[event.to_status] : "Triage";
      const assigned = event.to_assignee_name
        ? `, assigned to ${namePart(event.to_assignee_name, event.to_assignee_id, viewerId)}`
        : "";
      return `${who} raised this in ${status}${assigned}`;
    }
    case "status_changed": {
      const from = event.from_status ? STATUS_LABELS[event.from_status] : "—";
      const to = event.to_status ? STATUS_LABELS[event.to_status] : "—";
      return `${who} moved this from ${from} to ${to}`;
    }
    case "assignment_changed": {
      const to = event.to_assignee_name
        ? namePart(event.to_assignee_name, event.to_assignee_id, viewerId)
        : null;
      const from = event.from_assignee_name
        ? namePart(event.from_assignee_name, event.from_assignee_id, viewerId)
        : null;

      if (to && from) return `${who} reassigned this from ${from} to ${to}`;
      if (to) return `${who} assigned this to ${to}`;
      if (from) return `${who} unassigned this from ${from}`;
      return `${who} changed the assignment`;
    }
  }
}

/** "you" rather than your own name, when the trail is talking about the reader. */
function namePart(
  name: string,
  userId: string | null,
  viewerId: string | null,
): string {
  return viewerId !== null && userId === viewerId ? "you" : name;
}
