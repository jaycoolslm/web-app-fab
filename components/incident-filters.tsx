"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  ANY_ASSIGNEE,
  NO_ASSIGNEE,
  filtersToSuffix,
  isFiltered,
  toggleSeverity,
  type IncidentFilters,
} from "@/lib/filters";
import {
  SEVERITIES,
  SEVERITY_CHIP_CLASS,
  SEVERITY_LABELS,
  UNASSIGNED_LABEL,
  type Severity,
  type TeamMember,
} from "@/lib/incidents";
import { cn } from "@/lib/utils";

/**
 * The filter controls for both desk views.
 *
 * Every control does exactly one thing: rewrite the URL. There is no local copy
 * of the filter state to fall out of step, and the page that comes back has
 * already been filtered by the database — so the count in the header and the
 * rows underneath cannot disagree.
 *
 * `replace`, not `push`: fiddling with filters should not fill the back button
 * with every intermediate combination. The URL still updates, so a reload keeps
 * the filter, and stepping back out of an incident lands on the filtered list.
 */
export function IncidentFilters({
  basePath,
  filters,
  people,
  viewerId,
  shown,
  total,
}: {
  basePath: "/incidents" | "/board";
  filters: IncidentFilters;
  people: TeamMember[];
  viewerId: string | null;
  /** How many incidents survived the filter. */
  shown: number;
  /** How many the team has in total. */
  total: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const go = (next: IncidentFilters) => {
    startTransition(() => {
      router.replace(`${basePath}${filtersToSuffix(next)}`, { scroll: false });
    });
  };

  const filtered = isFiltered(filters);

  return (
    <section
      aria-label="Filter incidents"
      data-testid="incident-filters"
      data-filtered={filtered ? "true" : "false"}
      aria-busy={isPending || undefined}
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-3 transition-opacity",
        isPending && "opacity-60",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Severity
          </span>
          <div className="flex items-center gap-1" role="group">
            {SEVERITIES.map((severity) => (
              <SeverityChip
                key={severity}
                severity={severity}
                on={filters.severities.includes(severity)}
                onToggle={() => go(toggleSeverity(filters, severity))}
              />
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label
            htmlFor="filter-assignee"
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            Assignee
          </label>
          <select
            id="filter-assignee"
            data-testid="filter-assignee"
            value={filters.assignee}
            onChange={(event) =>
              go({ ...filters, assignee: event.target.value })
            }
            className={cn(
              "h-8 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            )}
          >
            <option value={ANY_ASSIGNEE}>Anyone</option>
            <option value={NO_ASSIGNEE}>{UNASSIGNED_LABEL}</option>
            {people.map((person) => (
              <option key={person.user_id} value={person.user_id}>
                {person.display_name}
                {person.user_id === viewerId ? " (you)" : ""}
              </option>
            ))}
          </select>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!filtered}
          onClick={() => go({ severities: [], assignee: ANY_ASSIGNEE })}
          data-testid="clear-filters"
        >
          Clear filters
        </Button>
      </div>

      <p className="text-xs text-muted-foreground" data-testid="filter-summary">
        {filtered ? (
          <>
            Showing{" "}
            <span className="font-medium tabular-nums" data-testid="filter-shown">
              {shown}
            </span>{" "}
            of <span className="tabular-nums">{total}</span>{" "}
            {total === 1 ? "incident" : "incidents"} · {describe(filters, people)}
          </>
        ) : (
          <>
            Showing all{" "}
            <span className="font-medium tabular-nums" data-testid="filter-shown">
              {shown}
            </span>{" "}
            {shown === 1 ? "incident" : "incidents"}. Filters are kept in the
            address bar, so this view can be reloaded or shared.
          </>
        )}
      </p>
    </section>
  );
}

function SeverityChip({
  severity,
  on,
  onToggle,
}: {
  severity: Severity;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={`${SEVERITY_LABELS[severity]}${on ? " — showing" : ""}`}
      onClick={onToggle}
      data-testid={`filter-severity-${severity}`}
      data-on={on ? "true" : "false"}
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        on
          ? SEVERITY_CHIP_CLASS[severity]
          : "border-input text-muted-foreground hover:bg-accent",
      )}
    >
      {severity}
    </button>
  );
}

/** The filter in words, for the summary line under the controls. */
function describe(filters: IncidentFilters, people: TeamMember[]): string {
  const parts: string[] = [];

  if (filters.severities.length > 0) {
    parts.push(filters.severities.join(", "));
  }
  if (filters.assignee === NO_ASSIGNEE) {
    parts.push(UNASSIGNED_LABEL.toLowerCase());
  } else if (filters.assignee !== ANY_ASSIGNEE) {
    const person = people.find((one) => one.user_id === filters.assignee);
    parts.push(`assigned to ${person?.display_name ?? "someone else"}`);
  }

  return parts.join(" · ");
}
