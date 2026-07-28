import { createClient } from "@/lib/supabase/server";
import type { Team } from "@/lib/incidents";

/**
 * The team the signed-in user belongs to, or null if their account was created
 * outside the signup flow and never joined one.
 *
 * There is no membership filter here because there does not need to be: the
 * RLS policy on `teams` is `private.is_team_member(id)`, so this query can only
 * ever return teams the caller belongs to.
 */
export async function getViewerTeam(): Promise<Team | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("teams")
    .select("id,name")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<Team>();

  if (error) {
    console.error("[incidents] could not resolve viewer team:", error.message);
    return null;
  }

  return data;
}
