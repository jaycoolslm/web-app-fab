"use server";

import { refresh, revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import {
  isSeverity,
  isStatus,
  type AssignIncidentResult,
  type CreateIncidentState,
} from "@/lib/incidents";
import { getViewerTeam } from "@/lib/team";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Postgres foreign key violation — here, an assignee who is not on the team. */
const FOREIGN_KEY_VIOLATION = "23503";

export async function createIncident(
  previous: CreateIncidentState,
  formData: FormData,
): Promise<CreateIncidentState> {
  const fail = (error: string): CreateIncidentState => ({
    error,
    createdCount: previous.createdCount,
  });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  // The team is resolved from the caller's own membership rather than read off
  // the form, so there is no team_id for a client to tamper with. Row level
  // security would reject a forged one anyway.
  const team = await getViewerTeam();
  if (!team) {
    return fail("Your account is not a member of a team yet.");
  }

  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const severity = formData.get("severity");
  const status = formData.get("status");

  if (!title) {
    return fail("Give the incident a title.");
  }
  if (title.length > 200) {
    return fail("Titles are limited to 200 characters.");
  }
  if (!isSeverity(severity)) {
    return fail("Choose a severity between P1 and P4.");
  }
  if (!isStatus(status)) {
    return fail("Choose a valid status.");
  }

  const { error } = await supabase.from("incidents").insert({
    team_id: team.id,
    title,
    description,
    severity,
    status,
    created_by: user.id,
  });

  if (error) {
    return fail(error.message);
  }

  revalidatePath("/incidents");
  return { error: null, createdCount: previous.createdCount + 1 };
}

/**
 * Hand one incident to a teammate, or take it off everybody.
 *
 * Like the board's move, this is scoped by id alone and runs on the caller's own
 * session, so two database rules decide the outcome and no application check
 * stands in for them:
 *
 *   * RLS (`incidents are edited inside your own team`) means another team's
 *     incident matches no rows — the same answer a hand-rolled POST would get.
 *   * The composite foreign key `(team_id, assignee_id) → team_members` means a
 *     profile from another team is refused even on an incident you *can* edit.
 *
 * The trail entry is not written here either: a trigger on `incidents` writes
 * it, so it exists whether the change came from this action, from the board, or
 * from a PATCH straight at the Data API.
 */
export async function assignIncident(
  incidentId: string,
  assigneeId: string | null,
): Promise<AssignIncidentResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  if (!UUID_RE.test(incidentId)) {
    return { ok: false, error: "that incident id is not valid." };
  }
  if (assigneeId !== null && !UUID_RE.test(assigneeId)) {
    return { ok: false, error: "that is not somebody we can assign." };
  }

  const { data, error } = await supabase
    .from("incidents")
    .update({ assignee_id: assigneeId })
    .eq("id", incidentId)
    .select("id,assignee_id");

  if (error) {
    if (error.code === FOREIGN_KEY_VIOLATION) {
      return {
        ok: false,
        error: "that person is not on this incident's team.",
      };
    }
    console.error("[incidents] assignment rejected by the database:", error.message);
    return { ok: false, error: "the desk refused that change." };
  }

  // Zero rows is the RLS refusal: the incident either does not exist or belongs
  // to another team. We do not say which, because saying would itself leak.
  if (!data || data.length === 0) {
    return { ok: false, error: "that incident is not yours to assign." };
  }

  // `refresh` updates the page the picker is on — including the trail entry the
  // trigger has just written. `revalidatePath` is for the two views the change
  // also shows up in, so walking back to a list held in the client router cache
  // does not show the old assignee.
  refresh();
  revalidatePath("/incidents");
  revalidatePath("/board");

  return { ok: true, assigneeId };
}
