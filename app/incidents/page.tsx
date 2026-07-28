import Link from "next/link";
import { Suspense } from "react";

import { IncidentCreateForm } from "@/components/incident-create-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import {
  SEVERITY_CHIP_CLASS,
  STATUS_CHIP_CLASS,
  STATUS_LABELS,
  type Incident,
} from "@/lib/incidents";
import { cn } from "@/lib/utils";
import { getViewerTeam } from "./data";

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

async function IncidentsBoard() {
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
  // teams out. P1 first, then newest first within a severity.
  const { data, error } = await supabase
    .from("incidents")
    .select("*")
    .eq("team_id", team.id)
    .order("severity", { ascending: true })
    .order("created_at", { ascending: false });

  const incidents = (data ?? []) as Incident[];

  return (
    <>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Incidents</h1>
        <p className="text-sm text-muted-foreground">
          Everything open and closed for{" "}
          <span className="font-medium">{team.name}</span>, highest severity
          first.
        </p>
      </header>

      <IncidentCreateForm />

      {error && (
        <p className="text-sm text-red-500" data-testid="incidents-error">
          Could not load incidents: {error.message}
        </p>
      )}

      {incidents.length === 0 ? (
        <Card data-testid="incidents-empty-state">
          <CardContent className="py-10 text-center space-y-1">
            <p className="font-medium">No incidents on the board.</p>
            <p className="text-sm text-muted-foreground">
              Nothing has been raised for {team.name} yet. Use the form above
              when something breaks.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="incidents-list">
          {incidents.map((incident) => (
            <li key={incident.id} data-testid={`incident-row-${incident.id}`}>
              <Link
                href={`/incidents/${incident.id}`}
                className="block rounded-lg border p-4 transition-colors hover:bg-accent"
                data-testid={`incident-link-${incident.id}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <p className="font-medium" data-testid="incident-title">
                      {incident.title}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Raised {formatWhen(incident.created_at)}
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
          ))}
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

export default function IncidentsPage() {
  // Everything below reads cookies to identify the caller, so it streams in
  // behind a Suspense boundary.
  return (
    <Suspense fallback={<BoardSkeleton />}>
      <IncidentsBoard />
    </Suspense>
  );
}
