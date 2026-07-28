import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";

export default function IncidentNotFound() {
  return (
    <Card data-testid="incident-not-found">
      <CardContent className="py-10 text-center space-y-2">
        <p className="font-medium">Incident not found.</p>
        <p className="text-sm text-muted-foreground">
          It does not exist, or it belongs to another team.
        </p>
        <Link
          href="/incidents"
          className="inline-block text-sm underline underline-offset-4"
          data-testid="not-found-back-link"
        >
          Back to incidents
        </Link>
      </CardContent>
    </Card>
  );
}
