"use client";

import { useEffect, useState } from "react";

import { assignIncident } from "@/app/incidents/actions";
import { UNASSIGNED_LABEL, type TeamMember } from "@/lib/incidents";
import { cn } from "@/lib/utils";

/** The select's value for "nobody" — an empty option value round-trips badly. */
const NOBODY = "unassigned";

/**
 * Who is holding this incident.
 *
 * The options are the signed-in user's own team and nothing else. That is a
 * courtesy, not a control: the database refuses an assignee who is not on the
 * incident's team whatever this picker sends, so a tampered option value is a
 * refusal rather than a cross-team assignment.
 */
export function AssigneePicker({
  incidentId,
  assigneeId,
  people,
  viewerId,
}: {
  incidentId: string;
  assigneeId: string | null;
  people: TeamMember[];
  viewerId: string | null;
}) {
  // Optimistic: the select shows what was asked for while the request is in
  // flight, and falls back to the server's answer if it is refused.
  const [chosen, setChosen] = useState<string | null>(assigneeId);
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  // Whatever the server last told us wins once it arrives.
  useEffect(() => {
    setChosen(assigneeId);
  }, [assigneeId]);

  const change = (value: string) => {
    const next = value === NOBODY ? null : value;
    if (next === chosen) return;

    const previous = chosen;
    setChosen(next);
    setSaving(true);
    setRefusal(null);

    void assignIncident(incidentId, next).then(
      (result) => {
        setSaving(false);
        if (!result.ok) {
          setChosen(previous);
          setRefusal(`Could not change the assignee — ${result.error}`);
        }
      },
      (error: unknown) => {
        setSaving(false);
        setChosen(previous);
        console.error("[incidents] assignment failed:", error);
        setRefusal("Could not change the assignee — the desk could not be reached.");
      },
    );
  };

  return (
    <div className="flex flex-col gap-1.5" data-testid="assignee-picker">
      <label
        htmlFor="incident-assignee"
        className="text-sm font-medium text-muted-foreground"
      >
        Assignee
      </label>

      <div className="flex items-center gap-2">
        <select
          id="incident-assignee"
          value={chosen ?? NOBODY}
          disabled={saving}
          onChange={(event) => change(event.target.value)}
          data-testid="assignee-select"
          data-assignee={chosen ?? NOBODY}
          className={cn(
            "h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            "disabled:opacity-60",
          )}
        >
          <option value={NOBODY}>{UNASSIGNED_LABEL}</option>
          {people.map((person) => (
            <option key={person.user_id} value={person.user_id}>
              {person.display_name}
              {person.user_id === viewerId ? " (you)" : ""}
            </option>
          ))}
        </select>

        {saving && (
          <span
            className="text-xs text-muted-foreground"
            data-testid="assignee-saving"
          >
            Saving…
          </span>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Only {people.length === 1 ? "you" : `your team (${people.length} people)`}{" "}
        can hold this incident.
      </p>

      {refusal && (
        <p
          role="alert"
          className="text-xs text-red-600 dark:text-red-400"
          data-testid="assignee-refusal"
        >
          {refusal}
        </p>
      )}
    </div>
  );
}
