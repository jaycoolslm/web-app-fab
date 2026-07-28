/**
 * The one read path behind both desk views. The list and the board differ only
 * in which columns they ask for, so they share the filter arithmetic — and
 * neither can drift into filtering on the client, where a "hidden" incident is
 * still sitting in the page.
 */

import { ANY_ASSIGNEE, NO_ASSIGNEE, type IncidentFilters } from "@/lib/filters";
import type { TeamMember } from "@/lib/incidents";
import { createClient } from "@/lib/supabase/server";

export type DeskIncidents<Row> = {
  rows: Row[];
  /** How many the team has in total, ignoring the filter. */
  total: number;
  error: string | null;
};

export async function loadDeskIncidents<Row>(
  columns: string,
  teamId: string,
  filters: IncidentFilters,
): Promise<DeskIncidents<Row>> {
  const supabase = await createClient();

  // Row level security already limits this table to the caller's team; the
  // team_id filter says *which* team we are looking at, it is not what keeps
  // other teams out.
  let query = supabase.from("incidents").select(columns).eq("team_id", teamId);

  if (filters.severities.length > 0) {
    query = query.in("severity", filters.severities);
  }
  if (filters.assignee === NO_ASSIGNEE) {
    query = query.is("assignee_id", null);
  } else if (filters.assignee !== ANY_ASSIGNEE) {
    query = query.eq("assignee_id", filters.assignee);
  }

  const [filtered, everything] = await Promise.all([
    // P1 first, then newest first within a severity — the same order the board
    // keeps within each column.
    query.order("severity").order("created_at", { ascending: false }),
    supabase
      .from("incidents")
      .select("id", { count: "exact", head: true })
      .eq("team_id", teamId),
  ]);

  return {
    rows: (filtered.data ?? []) as unknown as Row[],
    total: everything.count ?? 0,
    error: filtered.error?.message ?? null,
  };
}

/**
 * Everyone on one team, for the assignee picker and for putting a name to an
 * `assignee_id`. `team_directory` is a `security_invoker` view over
 * `team_members` and `profiles`, so this cannot return anybody the caller is
 * not already entitled to see — the `eq` is for clarity, not for safety.
 */
export async function loadTeamMembers(teamId: string): Promise<TeamMember[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("team_directory")
    .select("user_id,display_name,email")
    .eq("team_id", teamId)
    .order("display_name");

  if (error) {
    console.error("[desk] could not read the team directory:", error.message);
    return [];
  }

  return (data ?? []) as TeamMember[];
}

export function byUserId(people: TeamMember[]): Map<string, TeamMember> {
  return new Map(people.map((person) => [person.user_id, person]));
}
