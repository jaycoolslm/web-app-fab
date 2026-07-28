/**
 * Filter state for the list and the board.
 *
 * The URL is the only place this state lives. Nothing is held in a component,
 * so a reload, a back-navigation out of a detail page and a link pasted into a
 * fresh session all reconstruct exactly the same view — and the server can
 * apply the filter in the query, which is what makes a filtered-out incident
 * genuinely absent from the page rather than merely hidden.
 */

import { SEVERITIES, type Severity } from "@/lib/incidents";

/** Assignee filter: nobody in particular, explicitly nobody, or one person. */
export const ANY_ASSIGNEE = "any";
export const NO_ASSIGNEE = "unassigned";

export type AssigneeFilter = typeof ANY_ASSIGNEE | typeof NO_ASSIGNEE | string;

export type IncidentFilters = {
  /** Empty means every severity. Always in SEVERITIES order. */
  severities: Severity[];
  /** `"any"`, `"unassigned"`, or a user id. */
  assignee: AssigneeFilter;
};

export const NO_FILTERS: IncidentFilters = {
  severities: [],
  assignee: ANY_ASSIGNEE,
};

/** The shape Next hands a page as `searchParams`. */
export type RawSearchParams = Record<string, string | string[] | undefined>;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read filters out of a query string. Anything unrecognised is dropped rather
 * than errored on: a hand-edited or stale URL should degrade to a wider view,
 * never to a broken page.
 *
 * `?severity=P1&severity=P2` and `?severity=P1,P2` both work, because both are
 * things people write by hand.
 */
export function parseFilters(params: RawSearchParams): IncidentFilters {
  const raw = params.severity;
  const requested = (Array.isArray(raw) ? raw : raw ? [raw] : [])
    .flatMap((value) => value.split(","))
    .map((value) => value.trim().toUpperCase());

  // Filtered out of SEVERITIES rather than out of the request, so the result is
  // deduplicated and in canonical order whatever order the URL listed them in.
  const severities = SEVERITIES.filter((severity) =>
    requested.includes(severity),
  );

  const assigneeRaw = params.assignee;
  const assignee = Array.isArray(assigneeRaw) ? assigneeRaw[0] : assigneeRaw;

  return {
    severities,
    assignee:
      assignee === NO_ASSIGNEE || (assignee && UUID_RE.test(assignee))
        ? assignee
        : ANY_ASSIGNEE,
  };
}

/** The canonical query string for a filter state. Empty when nothing is set. */
export function filtersToQuery(filters: IncidentFilters): string {
  const params = new URLSearchParams();
  for (const severity of filters.severities) params.append("severity", severity);
  if (filters.assignee !== ANY_ASSIGNEE) params.set("assignee", filters.assignee);
  return params.toString();
}

/** `?a=b`, or `""` — ready to append to a path. */
export function filtersToSuffix(filters: IncidentFilters): string {
  const query = filtersToQuery(filters);
  return query ? `?${query}` : "";
}

export function isFiltered(filters: IncidentFilters): boolean {
  return filters.severities.length > 0 || filters.assignee !== ANY_ASSIGNEE;
}

/** Toggle one severity in or out of the filter. */
export function toggleSeverity(
  filters: IncidentFilters,
  severity: Severity,
): IncidentFilters {
  const on = filters.severities.includes(severity);
  return {
    ...filters,
    severities: SEVERITIES.filter((candidate) =>
      candidate === severity ? !on : filters.severities.includes(candidate),
    ),
  };
}

/**
 * A filtered link back to the list, for a detail page to offer. The query
 * arrives as untrusted text, so it is parsed back into filters and re-serialised
 * rather than pasted onto a path.
 */
export function listHrefFromRawQuery(query: string | undefined): string {
  if (!query) return "/incidents";
  const params = new URLSearchParams(query);
  const raw: RawSearchParams = {
    severity: params.getAll("severity"),
    assignee: params.get("assignee") ?? undefined,
  };
  return `/incidents${filtersToSuffix(parseFilters(raw))}`;
}
