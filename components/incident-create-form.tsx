"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";

import { createIncident } from "@/app/incidents/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  initialCreateIncidentState,
  SEVERITIES,
  SEVERITY_LABELS,
  STATUSES,
  STATUS_LABELS,
} from "@/lib/incidents";
import { cn } from "@/lib/utils";

const selectClass = cn(
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm",
  "transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm",
);

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} data-testid="create-incident-submit">
      {pending ? "Raising…" : "Raise incident"}
    </Button>
  );
}

export function IncidentCreateForm() {
  const [state, formAction] = useActionState(
    createIncident,
    initialCreateIncidentState,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.createdCount > 0) {
      formRef.current?.reset();
    }
  }, [state.createdCount]);

  return (
    <Card data-testid="create-incident-card">
      <CardHeader>
        <CardTitle className="text-lg">Raise an incident</CardTitle>
        <CardDescription>
          It is filed against your team and visible only to your team.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          ref={formRef}
          action={formAction}
          className="flex flex-col gap-4"
          data-testid="create-incident-form"
        >
          <div className="grid gap-2">
            <Label htmlFor="incident-title">Title</Label>
            <Input
              id="incident-title"
              name="title"
              required
              maxLength={200}
              placeholder="Core router flapping in LON1"
              data-testid="create-incident-title"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="incident-description">Description</Label>
            <textarea
              id="incident-description"
              name="description"
              rows={3}
              maxLength={4000}
              placeholder="What is happening, and what have you tried?"
              className={cn(selectClass, "h-auto py-2")}
              data-testid="create-incident-description"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="incident-severity">Severity</Label>
              <select
                id="incident-severity"
                name="severity"
                defaultValue="P3"
                className={selectClass}
                data-testid="create-incident-severity"
              >
                {SEVERITIES.map((severity) => (
                  <option key={severity} value={severity}>
                    {SEVERITY_LABELS[severity]}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="incident-status">Status</Label>
              <select
                id="incident-status"
                name="status"
                defaultValue="triage"
                className={selectClass}
                data-testid="create-incident-status"
              >
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {state.error && (
            <p className="text-sm text-red-500" data-testid="create-incident-error">
              {state.error}
            </p>
          )}

          <div>
            <SubmitButton />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
