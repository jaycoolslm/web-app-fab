"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { isStatus, type MoveIncidentResult } from "@/lib/incidents";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Move one incident into a new board column.
 *
 * Deliberately *not* scoped by team_id. The client hands over an id and a
 * status, nothing else, and the `update` runs on the caller's own session — so
 * the RLS policy `incidents are edited inside your own team` is what decides
 * whether the row is theirs to touch. An id belonging to another team matches
 * no rows and comes back refused, which is the same answer you get from a
 * direct POST to this action with a stolen id.
 *
 * Running this through a service-role client would silently defeat all of that,
 * which is why there is no service-role client in the codebase.
 */
export async function moveIncident(
  incidentId: string,
  status: string,
): Promise<MoveIncidentResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  if (!isStatus(status)) {
    return { ok: false, error: "that is not a column on this board." };
  }
  // A malformed id would otherwise reach Postgres as an invalid-uuid error;
  // refuse it here so the board gets a sentence rather than a driver message.
  if (!UUID_RE.test(incidentId)) {
    return { ok: false, error: "that incident id is not valid." };
  }

  const { data, error } = await supabase
    .from("incidents")
    .update({ status })
    .eq("id", incidentId)
    .select("id,status");

  // Anything left here is a constraint or a connectivity problem, not something
  // the user chose. It goes to the server log; they get a sentence.
  if (error) {
    console.error("[board] move rejected by the database:", error.message);
    return { ok: false, error: "the desk refused that change." };
  }

  // Zero rows updated is the RLS refusal: the row either does not exist or
  // belongs to a team the caller is not a member of. We do not distinguish
  // between those two, because saying which would itself leak.
  if (!data || data.length === 0) {
    return { ok: false, error: "that incident is not yours to move." };
  }

  refresh();
  return { ok: true, status };
}
