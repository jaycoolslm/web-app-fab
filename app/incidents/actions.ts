"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import {
  isSeverity,
  isStatus,
  type CreateIncidentState,
} from "@/lib/incidents";
import { getViewerTeam } from "@/lib/team";

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
