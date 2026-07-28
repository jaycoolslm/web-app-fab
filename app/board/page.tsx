import Link from "next/link";
import { Suspense } from "react";

import { IncidentBoard } from "@/components/incident-board";
import { IncidentFilters } from "@/components/incident-filters";
import { Card, CardContent } from "@/components/ui/card";
import { loadDeskIncidents, loadTeamMembers } from "@/lib/desk";
import { filtersToSuffix, parseFilters } from "@/lib/filters";
import { STATUS_LABELS, STATUSES, type BoardCard } from "@/lib/incidents";
import { createClient } from "@/lib/supabase/server";
import { getViewerTeam } from "@/lib/team";

export const metadata = {
  title: "Board — Incident desk",
};

async function Board({
  searchParams,
}: Pick<PageProps<"/board">, "searchParams">) {
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
    loadDeskIncidents<BoardCard>(
      "id,title,severity,status,assignee_id,created_at",
      team.id,
      filters,
    ),
    loadTeamMembers(team.id),
  ]);

  const suffix = filtersToSuffix(filters);

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Board</h1>
          <p className="text-sm text-muted-foreground" data-testid="board-summary">
            {incidents.length}{" "}
            {incidents.length === 1 ? "incident" : "incidents"} for{" "}
            <span className="font-medium">{team.name}</span> across{" "}
            {STATUSES.length} states.
          </p>
        </div>
        <Link
          href={`/incidents${suffix}`}
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          data-testid="board-to-list-link"
        >
          Open the list view
        </Link>
      </header>

      <IncidentFilters
        basePath="/board"
        filters={filters}
        people={people}
        viewerId={user?.id ?? null}
        shown={incidents.length}
        total={total}
      />

      {error && (
        <p className="text-sm text-red-500" data-testid="board-error">
          Could not load the board: {error}
        </p>
      )}

      <IncidentBoard
        incidents={incidents}
        teamName={team.name}
        people={people}
        detailQuery={suffix.slice(1)}
        // Rebuilt from scratch when the filter changes, so no optimistic move
        // from the previous view survives into a set of cards it no longer
        // describes.
        key={suffix}
      />
    </>
  );
}

function BoardSkeleton() {
  return (
    <div className="space-y-4" data-testid="board-loading">
      <div className="h-8 w-32 rounded bg-foreground/10 animate-pulse" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {STATUSES.map((status) => (
          <div
            key={status}
            className="h-48 rounded-lg bg-foreground/5 animate-pulse"
            aria-label={STATUS_LABELS[status]}
          />
        ))}
      </div>
    </div>
  );
}

export default function BoardPage({ searchParams }: PageProps<"/board">) {
  // Everything below reads cookies and the query string to decide what to show,
  // so it streams in behind a Suspense boundary rather than blocking the shell.
  return (
    <Suspense fallback={<BoardSkeleton />}>
      <Board searchParams={searchParams} />
    </Suspense>
  );
}
