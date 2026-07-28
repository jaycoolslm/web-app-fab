import Link from "next/link";
import { Suspense } from "react";

import { IncidentBoard } from "@/components/incident-board";
import { Card, CardContent } from "@/components/ui/card";
import { STATUS_LABELS, STATUSES, type BoardCard } from "@/lib/incidents";
import { createClient } from "@/lib/supabase/server";
import { getViewerTeam } from "@/lib/team";

export const metadata = {
  title: "Board — Incident desk",
};

async function Board() {
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

  // Row level security already limits this table to the caller's team; the
  // filter says *which* team we are looking at, it is not what keeps other
  // teams out. P1 first, then newest first within a severity — the same order
  // the board keeps within each column.
  const { data, error } = await supabase
    .from("incidents")
    .select("id,title,severity,status,created_at")
    .eq("team_id", team.id)
    .order("severity", { ascending: true })
    .order("created_at", { ascending: false });

  const incidents = (data ?? []) as BoardCard[];

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Board</h1>
          <p className="text-sm text-muted-foreground">
            {incidents.length}{" "}
            {incidents.length === 1 ? "incident" : "incidents"} for{" "}
            <span className="font-medium">{team.name}</span> across{" "}
            {STATUSES.length} states.
          </p>
        </div>
        <Link
          href="/incidents"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          data-testid="board-to-list-link"
        >
          Open the list view
        </Link>
      </header>

      {error && (
        <p className="text-sm text-red-500" data-testid="board-error">
          Could not load the board: {error.message}
        </p>
      )}

      <IncidentBoard incidents={incidents} teamName={team.name} />
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

export default function BoardPage() {
  // Everything below reads cookies to identify the caller, so it streams in
  // behind a Suspense boundary.
  return (
    <Suspense fallback={<BoardSkeleton />}>
      <Board />
    </Suspense>
  );
}
