import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import {
  SEVERITY_CHIP_CLASS,
  SEVERITY_LABELS,
  STATUS_CHIP_CLASS,
  STATUS_LABELS,
  type Incident,
} from "@/lib/incidents";
import { cn } from "@/lib/utils";

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

async function IncidentDetail({ params }: { params: Promise<{ id: string }> }) {
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
      </CardContent>
    </Card>
  );
}

export default function IncidentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <>
      <div>
        <Link
          href="/incidents"
          className="text-sm text-muted-foreground hover:underline"
          data-testid="back-to-incidents"
        >
          ← All incidents
        </Link>
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
