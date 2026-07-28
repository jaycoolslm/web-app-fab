import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ActivityTrail } from "@/components/activity-trail";
import { AssigneePicker } from "@/components/assignee-picker";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { loadTeamMembers } from "@/lib/desk";
import { listHrefFromRawQuery } from "@/lib/filters";
import { createClient } from "@/lib/supabase/server";
import {
  SEVERITY_CHIP_CLASS,
  SEVERITY_LABELS,
  STATUS_CHIP_CLASS,
  STATUS_LABELS,
  type Incident,
  type IncidentEvent,
} from "@/lib/incidents";
import { cn } from "@/lib/utils";

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

async function IncidentDetail({ params }: Pick<PageProps<"/incidents/[id]">, "params">) {
  const { id } = await params;
  const supabase = await createClient();

  // No team filter and no membership check here on purpose: row level security
  // is what decides. Another team's id simply returns nothing, and a malformed
  // id errors out — both land on the same not-found page, so neither confirms
  // whether the incident exists.
  const { data } = await supabase
    .from("incidents")
    .select("*")
    .eq("id", id)
    .maybeSingle<Incident>();

  if (!data) {
    notFound();
  }

  const incident = data;

  const [viewer, people, trail] = await Promise.all([
    supabase.auth.getUser().then((result) => result.data.user),
    // The incident's own team, which RLS has already established is the
    // viewer's. Reading it off the row rather than off the session means the
    // picker cannot offer somebody the database would then refuse.
    loadTeamMembers(incident.team_id),
    // Same story for the trail: `incident_id` alone, with the policy on
    // `incident_events` deciding whether any rows come back. `seq` rather than
    // `created_at`, because a status change and a reassignment made in one
    // statement share a timestamp.
    supabase
      .from("incident_events")
      .select("*")
      .eq("incident_id", incident.id)
      .order("seq", { ascending: false }),
  ]);

  const events = (trail.data ?? []) as IncidentEvent[];

  return (
    <Card data-testid="incident-detail">
      <CardHeader className="space-y-3">
        <div className="flex items-center gap-2">
          <Badge
            className={cn(SEVERITY_CHIP_CLASS[incident.severity])}
            data-testid="incident-detail-severity"
          >
            {SEVERITY_LABELS[incident.severity]}
          </Badge>
          <Badge
            variant="outline"
            className={cn(STATUS_CHIP_CLASS[incident.status])}
            data-testid="incident-detail-status"
          >
            {STATUS_LABELS[incident.status]}
          </Badge>
        </div>
        <CardTitle className="text-2xl" data-testid="incident-detail-title">
          {incident.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-1">
            Description
          </h2>
          <p
            className="whitespace-pre-wrap text-sm"
            data-testid="incident-detail-description"
          >
            {incident.description || "No description was given."}
          </p>
        </div>

        <AssigneePicker
          incidentId={incident.id}
          assigneeId={incident.assignee_id}
          people={people}
          viewerId={viewer?.id ?? null}
        />

        <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Raised</dt>
            <dd data-testid="incident-detail-created-at">
              {formatWhen(incident.created_at)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Last updated</dt>
            <dd data-testid="incident-detail-updated-at">
              {formatWhen(incident.updated_at)}
            </dd>
          </div>
        </dl>

        <ActivityTrail
          events={events}
          viewerId={viewer?.id ?? null}
          error={trail.error?.message ?? null}
        />
      </CardContent>
    </Card>
  );
}

/**
 * The link back to the list. `?from=` carries the filter that was in force when
 * the incident was opened; it is untrusted text, so it is parsed back into a
 * filter and re-serialised rather than pasted onto the path.
 */
async function BackLink({
  searchParams,
}: Pick<PageProps<"/incidents/[id]">, "searchParams">) {
  const { from } = await searchParams;
  const href = listHrefFromRawQuery(Array.isArray(from) ? from[0] : from);

  return (
    <Link
      href={href}
      className="text-sm text-muted-foreground hover:underline"
      data-testid="back-to-incidents"
    >
      ← All incidents
    </Link>
  );
}

export default function IncidentDetailPage({
  params,
  searchParams,
}: PageProps<"/incidents/[id]">) {
  return (
    <>
      <div>
        <Suspense
          fallback={
            <span className="text-sm text-muted-foreground">
              ← All incidents
            </span>
          }
        >
          <BackLink searchParams={searchParams} />
        </Suspense>
      </div>

      <Suspense
        fallback={
          <div
            className="h-64 rounded-lg bg-foreground/5 animate-pulse"
            data-testid="incident-loading"
          />
        }
      >
        <IncidentDetail params={params} />
      </Suspense>
    </>
  );
}
