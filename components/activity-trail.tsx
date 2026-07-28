import { describeEvent, type IncidentEvent } from "@/lib/incidents";

/** "3 minutes ago" up to a day, then the date — the resolution people care about. */
function relativeWhen(iso: string, now: number): string {
  const then = new Date(iso).getTime();
  const seconds = Math.round((now - then) / 1000);

  if (seconds < 45) return "just now";
  if (seconds < 90) return "a minute ago";
  if (seconds < 3600) return `${Math.round(seconds / 60)} minutes ago`;
  if (seconds < 7200) return "an hour ago";
  if (seconds < 86400) return `${Math.round(seconds / 3600)} hours ago`;
  return new Date(iso).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function exactWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    dateStyle: "full",
    timeStyle: "medium",
  });
}

/**
 * The incident's history, newest first.
 *
 * Every entry is a sentence rather than a field diff, because the trail is read
 * by whoever picks the incident up next. The rows themselves are append-only in
 * the database — nothing here can edit or delete one.
 */
export function ActivityTrail({
  events,
  viewerId,
  error,
}: {
  events: IncidentEvent[];
  viewerId: string | null;
  error: string | null;
}) {
  // One clock for the whole list, so two entries a second apart do not disagree
  // about what "now" was.
  const now = Date.now();

  return (
    <section className="space-y-3" data-testid="activity-trail">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Activity</h2>
        <span
          className="text-xs text-muted-foreground tabular-nums"
          data-testid="activity-count"
        >
          {events.length} {events.length === 1 ? "entry" : "entries"}
        </span>
      </div>

      {error && (
        <p className="text-sm text-red-500" data-testid="activity-error">
          Could not load the activity trail: {error}
        </p>
      )}

      {events.length === 0 && !error ? (
        <p
          className="text-sm text-muted-foreground"
          data-testid="activity-empty"
        >
          Nothing has happened to this incident yet.
        </p>
      ) : (
        <ol className="space-y-2" data-testid="activity-list">
          {events.map((event) => (
            <li
              key={event.id}
              data-testid={`activity-entry-${event.id}`}
              data-kind={event.kind}
              className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-md border-l-2 border-l-foreground/15 bg-foreground/[0.03] px-3 py-2"
            >
              <span className="text-sm" data-testid="activity-sentence">
                {describeEvent(event, viewerId)}
              </span>
              <time
                dateTime={event.created_at}
                title={exactWhen(event.created_at)}
                className="text-xs text-muted-foreground"
                data-testid="activity-when"
              >
                {relativeWhen(event.created_at, now)}
              </time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
