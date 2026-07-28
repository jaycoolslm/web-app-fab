import Link from "next/link";
import { Suspense } from "react";

import { IncidentCreateForm } from "@/components/incident-create-form";
import { IncidentFilters } from "@/components/incident-filters";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { byUserId, loadDeskIncidents, loadTeamMembers } from "@/lib/desk";
import { filtersToSuffix, isFiltered, parseFilters } from "@/lib/filters";
import { createClient } from "@/lib/supabase/server";
import {
  assigneeName,
  SEVERITY_CHIP_CLASS,
  STATUS_CHIP_CLASS,
  STATUS_LABELS,
  UNASSIGNED_LABEL,
  type Incident,
} from "@/lib/incidents";
import { getViewerTeam } from "@/lib/team";
import { cn } from "@/lib/utils";

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

async function IncidentsBoard({
  searchParams,
}: Pick<PageProps<"/incidents">, "searchParams">) {
  const filters = parseFilters(await searchParams);
  const team = await getViewerTeam();

  if (!team) {
    return (
      <Card data-testid="no-team-state">
        <CardContent className="py-8 space-y-2">
          <p className="font-medium">This account is not on a team yet.</p>
          <p className="text-sm text-muted-foreground">
            Teams are established at signup. Sign up again with a team name to
            join or create one.
          </p>
        </CardContent>
      </Card>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ rows: incidents, total, error }, people] = await Promise.all([
    loadDeskIncidents<Incident>("*", team.id, filters),
    loadTeamMembers(team.id),
  ]);
  const peopleById = byUserId(people);

  // Carried into the detail page so its back link returns to this exact view.
  // Browser back does the same thing; this is for people who click the link.
  const suffix = filtersToSuffix(filters);
  const detailHref = (id: string) =>
    suffix
      ? `/incidents/${id}?from=${encodeURIComponent(suffix.slice(1))}`
      : `/incidents/${id}`;

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Incidents</h1>
          <p className="text-sm text-muted-foreground">
            Everything open and closed for{" "}
            <span className="font-medium">{team.name}</span>, highest severity
            first.
          </p>
        </div>
        <Link
          href={`/board${suffix}`}
          className="rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
          data-testid="incidents-to-board-link"
        >
          Open the board
        </Link>
      </header>

      <IncidentCreateForm />

      <IncidentFilters
        basePath="/incidents"
        filters={filters}
        people={people}
        viewerId={user?.id ?? null}
        shown={incidents.length}
        total={total}
      />

      {error && (
        <p className="text-sm text-red-500" data-testid="incidents-error">
          Could not load incidents: {error}
        </p>
      )}

      {incidents.length === 0 ? (
        <Card data-testid="incidents-empty-state">
          <CardContent className="py-10 text-center space-y-1">
            {isFiltered(filters) ? (
              <>
                <p className="font-medium">Nothing matches this filter.</p>
                <p className="text-sm text-muted-foreground">
                  {team.name} has {total} {total === 1 ? "incident" : "incidents"}
                  , none of them matching. Clear the filters to see them.
                </p>
              </>
            ) : (
              <>
                <p className="font-medium">No incidents on the board.</p>
                <p className="text-sm text-muted-foreground">
                  Nothing has been raised for {team.name} yet. Use the form above
                  when something breaks.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="incidents-list">
          {incidents.map((incident) => {
            const holder = assigneeName(incident.assignee_id, peopleById);

            return (
              <li key={incident.id} data-testid={`incident-row-${incident.id}`}>
                <Link
                  href={detailHref(incident.id)}
                  className="block rounded-lg border p-4 transition-colors hover:bg-accent"
                  data-testid={`incident-link-${incident.id}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <p className="font-medium" data-testid="incident-title">
                        {incident.title}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Raised {formatWhen(incident.created_at)} ·{" "}
                        <span
                          data-testid="incident-assignee"
                          data-assignee={incident.assignee_id ?? "unassigned"}
                          className={cn(
                            holder ? "text-foreground" : "italic",
                          )}
                        >
                          {holder ? `Assigned to ${holder}` : UNASSIGNED_LABEL}
                        </span>
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge
                        className={cn(SEVERITY_CHIP_CLASS[incident.severity])}
                        data-testid="incident-severity"
                      >
                        {incident.severity}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={cn(STATUS_CHIP_CLASS[incident.status])}
                        data-testid="incident-status"
                      >
                        {STATUS_LABELS[incident.status]}
                      </Badge>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function BoardSkeleton() {
  return (
    <div className="space-y-4" data-testid="incidents-loading">
      <div className="h-8 w-40 rounded bg-foreground/10 animate-pulse" />
      <div className="h-64 rounded-lg bg-foreground/5 animate-pulse" />
    </div>
  );
}

export default function IncidentsPage({ searchParams }: PageProps<"/incidents">) {
  // Everything below reads cookies and the query string to decide what to show,
  // so it streams in behind a Suspense boundary rather than blocking the shell.
  return (
    <Suspense fallback={<BoardSkeleton />}>
      <IncidentsBoard searchParams={searchParams} />
    </Suspense>
  );
}
