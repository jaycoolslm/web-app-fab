/**
 * Tenant isolation suite.
 *
 * Every assertion runs through a real signed-in user session created via the
 * publishable key. There is deliberately no service-role client anywhere in
 * this file: that key bypasses row level security, so a suite using it would
 * report green against tables with no policies at all.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

assert.ok(
  SUPABASE_URL && SUPABASE_KEY,
  "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set (see .env.example)",
);

const PASSWORD = "incident-desk-test-pw";

function freshClient() {
  return createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Signs up a user against a named team — creating it if this is the first member
 * — and returns their session client.
 */
async function signUpOnTeam(label, teamName) {
  const suffix = randomUUID();
  const client = freshClient();
  const email = `${label}-${suffix}@example.com`;

  const { data, error } = await client.auth.signUp({
    email,
    password: PASSWORD,
    options: { data: { team_name: teamName } },
  });
  assert.equal(error, null, `signup failed for ${label}: ${error?.message}`);
  assert.ok(data.session, `signup for ${label} produced no session`);

  // Membership is established by the signup trigger; reading it back through
  // the user's own session also proves they can see their own team. Scoped to
  // their own row, because a team with other people on it returns those too.
  const { data: memberships, error: membershipError } = await client
    .from("team_members")
    .select("team_id")
    .eq("user_id", data.user.id);
  assert.equal(membershipError, null, membershipError?.message);
  assert.equal(memberships.length, 1, `${label} should belong to exactly one team`);

  return {
    client,
    userId: data.user.id,
    teamId: memberships[0].team_id,
    email,
    /** What the signup trigger will have derived as this user's display name. */
    displayName: email.split("@")[0],
  };
}

/** Signs up a user on a brand new team of their own. */
function signUpOnNewTeam(label) {
  return signUpOnTeam(label, `${label}-team-${randomUUID()}`);
}

/** The whole activity trail for one incident, newest first. */
async function trailFor(actor, incidentId) {
  const { data, error } = await actor.client
    .from("incident_events")
    .select("*")
    .eq("incident_id", incidentId)
    .order("seq", { ascending: false });
  assert.equal(error, null, error?.message);
  return data;
}

async function raiseIncident(actor, title, severity = "P2") {
  const { data, error } = await actor.client
    .from("incidents")
    .insert({
      team_id: actor.teamId,
      title,
      severity,
      created_by: actor.userId,
    })
    .select()
    .single();
  assert.equal(error, null, `could not raise "${title}": ${error?.message}`);
  return data;
}

describe("tenant isolation", () => {
  /** @type {Awaited<ReturnType<typeof signUpOnNewTeam>>} */
  let alice;
  /** Alice's teammate — the second person on her team, so assignment has a target. */
  /** @type {Awaited<ReturnType<typeof signUpOnNewTeam>>} */
  let anna;
  /** @type {Awaited<ReturnType<typeof signUpOnNewTeam>>} */
  let bob;
  let aliceIncident;
  let bobIncident;
  let aliceTeamName;

  before(async () => {
    aliceTeamName = `alice-team-${randomUUID()}`;
    alice = await signUpOnTeam("alice", aliceTeamName);
    anna = await signUpOnTeam("anna", aliceTeamName);
    bob = await signUpOnNewTeam("bob");

    assert.equal(anna.teamId, alice.teamId, "Anna must land on Alice's team");
    assert.notEqual(alice.teamId, bob.teamId, "fixtures must be on different teams");

    aliceIncident = await raiseIncident(alice, "Alice core router flapping", "P1");
    bobIncident = await raiseIncident(bob, "Bob edge switch degraded", "P3");
  });

  after(async () => {
    await alice?.client.auth.signOut();
    await anna?.client.auth.signOut();
    await bob?.client.auth.signOut();
  });

  it("each user lists only their own team's incidents", async () => {
    const { data: aliceSees, error: aliceError } = await alice.client
      .from("incidents")
      .select("id, team_id, title");
    assert.equal(aliceError, null, aliceError?.message);
    assert.deepEqual(
      aliceSees.map((row) => row.id),
      [aliceIncident.id],
    );

    const { data: bobSees, error: bobError } = await bob.client
      .from("incidents")
      .select("id, team_id, title");
    assert.equal(bobError, null, bobError?.message);
    assert.deepEqual(
      bobSees.map((row) => row.id),
      [bobIncident.id],
    );
  });

  it("a user cannot read another team's incident by id", async () => {
    const { data, error } = await bob.client
      .from("incidents")
      .select("id, title")
      .eq("id", aliceIncident.id);

    assert.equal(error, null, error?.message);
    assert.deepEqual(data, [], "another team's incident must not be readable by id");

    // `.single()` on the same query must fail to find a row rather than
    // disclosing one.
    const { data: single } = await bob.client
      .from("incidents")
      .select("id, title")
      .eq("id", aliceIncident.id)
      .maybeSingle();
    assert.equal(single, null);
  });

  it("a user cannot insert an incident attributed to another team", async () => {
    const { data, error } = await bob.client
      .from("incidents")
      .insert({
        team_id: alice.teamId,
        title: "Planted by Bob",
        severity: "P1",
        created_by: bob.userId,
      })
      .select();

    assert.notEqual(error, null, "insert into another team must be rejected");
    assert.equal(data, null);

    // And nothing landed: Alice still sees only her own incident.
    const { data: aliceSees } = await alice.client.from("incidents").select("id");
    assert.deepEqual(
      aliceSees.map((row) => row.id),
      [aliceIncident.id],
    );
  });

  it("a user cannot move their own incident into another team", async () => {
    const { data, error } = await bob.client
      .from("incidents")
      .update({ team_id: alice.teamId })
      .eq("id", bobIncident.id)
      .select();

    assert.notEqual(error, null, "moving an incident across teams must be rejected");
    assert.equal(data, null);

    const { data: unchanged } = await bob.client
      .from("incidents")
      .select("team_id")
      .eq("id", bobIncident.id)
      .single();
    assert.equal(unchanged.team_id, bob.teamId);
  });

  it("a user cannot edit another team's incident", async () => {
    const { data, error } = await bob.client
      .from("incidents")
      .update({ status: "resolved" })
      .eq("id", aliceIncident.id)
      .select();

    assert.equal(error, null, error?.message);
    assert.deepEqual(data, [], "the update must match no rows at all");

    const { data: stillOpen } = await alice.client
      .from("incidents")
      .select("status")
      .eq("id", aliceIncident.id)
      .single();
    assert.equal(stillOpen.status, "triage");
  });

  // -------------------------------------------------------------------------
  // The board's write path. Dropping a card calls an `update` that is scoped by
  // id alone — no team filter — so these tests are what stands between one
  // team's board and another team's incidents.
  // -------------------------------------------------------------------------

  it("a user cannot change the status of another team's incident by id", async () => {
    // Every column, not just one: the drop handler will happily send any of the
    // four, and a policy that leaked on one of them would leak on all.
    for (const status of ["triage", "investigating", "mitigating", "resolved"]) {
      const { data, error } = await bob.client
        .from("incidents")
        .update({ status })
        .eq("id", aliceIncident.id)
        .select("id, status");

      assert.equal(error, null, error?.message);
      assert.deepEqual(
        data,
        [],
        `setting status=${status} on another team's incident must match no rows`,
      );
    }

    // Handing over the exact id and the owning team's id together must not help
    // either — `using` is evaluated against the row as it stands.
    const spoofed = await bob.client
      .from("incidents")
      .update({ status: "resolved", team_id: alice.teamId })
      .eq("id", aliceIncident.id)
      .select("id");
    assert.ok(
      spoofed.error !== null ||
        (Array.isArray(spoofed.data) && spoofed.data.length === 0),
      "naming the owning team must not unlock the row",
    );

    // The owning team sees it exactly as it was: same column, and `updated_at`
    // untouched, which proves no row was written and rolled back by a check.
    const { data: owner, error: ownerError } = await alice.client
      .from("incidents")
      .select("status, severity, updated_at")
      .eq("id", aliceIncident.id)
      .single();
    assert.equal(ownerError, null, ownerError?.message);
    assert.equal(owner.status, aliceIncident.status);
    assert.equal(owner.severity, aliceIncident.severity);
    assert.equal(
      owner.updated_at,
      aliceIncident.updated_at,
      "the row must not have been touched at all",
    );
  });

  it("a user moves their own incident through every column", async () => {
    // A dedicated incident, so the assertions above about Alice's original one
    // keep holding whatever order the suite runs in.
    const card = await raiseIncident(alice, "Alice DNS resolver timing out", "P2");
    assert.equal(card.status, "triage", "incidents start in the triage column");

    for (const status of ["investigating", "mitigating", "resolved", "triage"]) {
      const { data, error } = await alice.client
        .from("incidents")
        .update({ status })
        .eq("id", card.id)
        .select("id, status");

      assert.equal(error, null, `moving to ${status} failed: ${error?.message}`);
      assert.deepEqual(data, [{ id: card.id, status }]);

      // Read it back on a fresh request, which is what a page reload does.
      const { data: persisted } = await alice.client
        .from("incidents")
        .select("status")
        .eq("id", card.id)
        .single();
      assert.equal(persisted.status, status, `${status} did not persist`);
    }

    // And none of that moving about made it visible to the other team.
    const { data: bobSees } = await bob.client
      .from("incidents")
      .select("id")
      .eq("id", card.id);
    assert.deepEqual(bobSees, []);
  });

  it("an unauthenticated client cannot move an incident", async () => {
    const anon = freshClient();
    const { data, error } = await anon
      .from("incidents")
      .update({ status: "resolved" })
      .eq("id", aliceIncident.id)
      .select("id");

    assert.ok(
      error !== null || (Array.isArray(data) && data.length === 0),
      "a signed-out client must not be able to move anything",
    );

    const { data: owner } = await alice.client
      .from("incidents")
      .select("status")
      .eq("id", aliceIncident.id)
      .single();
    assert.equal(owner.status, aliceIncident.status);
  });

  it("the database constrains the status a card can be dropped into", async () => {
    const { error } = await alice.client
      .from("incidents")
      .update({ status: "postmortem" })
      .eq("id", aliceIncident.id)
      .select("id");

    assert.notEqual(
      error,
      null,
      "an unknown column must be rejected by the database, not just the UI",
    );
  });

  it("an unauthenticated client reads nothing", async () => {
    const anon = freshClient();

    for (const table of ["incidents", "teams", "team_members"]) {
      const { data, error } = await anon.from(table).select("*");
      // Either the table is unreachable to anon or RLS yields zero rows.
      // Disclosing a single row is a failure.
      assert.ok(
        error !== null || (Array.isArray(data) && data.length === 0),
        `anon must not read ${table}, got ${JSON.stringify(data)}`,
      );
    }
  });

  // -------------------------------------------------------------------------
  // Membership, assignment and the activity trail.
  //
  // The assignee picker offers one team's people, and the trail is written by a
  // trigger rather than by the application. Both of those are conveniences; the
  // tests below are the enforcement.
  // -------------------------------------------------------------------------

  it("reading membership returns only the user's own team", async () => {
    const { data: aliceSees, error } = await alice.client
      .from("team_members")
      .select("team_id, user_id");
    assert.equal(error, null, error?.message);

    assert.deepEqual(
      [...new Set(aliceSees.map((row) => row.team_id))],
      [alice.teamId],
      "membership rows from another team must not be readable",
    );
    assert.deepEqual(
      aliceSees.map((row) => row.user_id).sort(),
      [alice.userId, anna.userId].sort(),
      "Alice should see exactly her own team's members",
    );
    assert.ok(
      !aliceSees.some((row) => row.user_id === bob.userId),
      "Bob must not appear in Alice's membership list",
    );

    // And the same question from the other side.
    const { data: bobSees } = await bob.client
      .from("team_members")
      .select("team_id, user_id");
    assert.deepEqual(bobSees.map((row) => row.user_id), [bob.userId]);
  });

  it("the assignee picker's source lists only the user's own team", async () => {
    // This is the query the picker and the assignee filter actually run.
    const { data, error } = await alice.client
      .from("team_directory")
      .select("team_id, user_id, display_name, email")
      .order("display_name");
    assert.equal(error, null, error?.message);

    assert.deepEqual(
      data.map((row) => row.user_id).sort(),
      [alice.userId, anna.userId].sort(),
      "the directory must be exactly the caller's own team",
    );
    assert.ok(
      data.every((row) => row.team_id === alice.teamId),
      "no other team may appear in the directory",
    );

    // Naming Bob's team explicitly must not widen it either.
    const { data: spoofed } = await alice.client
      .from("team_directory")
      .select("user_id")
      .eq("team_id", bob.teamId);
    assert.deepEqual(spoofed, []);

    // Nor may a profile be fetched directly by id.
    const { data: profile } = await alice.client
      .from("profiles")
      .select("id, display_name, email")
      .eq("id", bob.userId);
    assert.deepEqual(profile, [], "another team's profile must not be readable");
  });

  it("a user assigns an incident to a teammate, and it can be unassigned", async () => {
    const card = await raiseIncident(alice, "Alice BGP session down", "P2");
    assert.equal(card.assignee_id, null, "incidents start unassigned");

    const assigned = await alice.client
      .from("incidents")
      .update({ assignee_id: anna.userId })
      .eq("id", card.id)
      .select("id, assignee_id");
    assert.equal(assigned.error, null, assigned.error?.message);
    assert.deepEqual(assigned.data, [{ id: card.id, assignee_id: anna.userId }]);

    // Anna sees it on her own board too — assignment does not narrow visibility.
    const { data: annaSees } = await anna.client
      .from("incidents")
      .select("assignee_id")
      .eq("id", card.id)
      .single();
    assert.equal(annaSees.assignee_id, anna.userId);

    const cleared = await alice.client
      .from("incidents")
      .update({ assignee_id: null })
      .eq("id", card.id)
      .select("id, assignee_id");
    assert.equal(cleared.error, null, cleared.error?.message);
    assert.deepEqual(cleared.data, [{ id: card.id, assignee_id: null }]);
  });

  it("a user cannot assign a profile from another team", async () => {
    const card = await raiseIncident(alice, "Alice link errors on xe-0/0/1", "P3");

    const { data, error } = await alice.client
      .from("incidents")
      .update({ assignee_id: bob.userId })
      .eq("id", card.id)
      .select("id, assignee_id");

    assert.notEqual(
      error,
      null,
      "assigning somebody from another team must be refused by the database",
    );
    assert.equal(data, null);

    const { data: unchanged } = await alice.client
      .from("incidents")
      .select("assignee_id")
      .eq("id", card.id)
      .single();
    assert.equal(unchanged.assignee_id, null, "nothing may have been written");

    // Not even a user id that belongs to nobody at all.
    const { error: ghostError } = await alice.client
      .from("incidents")
      .update({ assignee_id: randomUUID() })
      .eq("id", card.id)
      .select("id");
    assert.notEqual(ghostError, null, "an unknown assignee must be refused");
  });

  it("a user cannot assign another team's incident", async () => {
    // To themselves...
    const toSelf = await bob.client
      .from("incidents")
      .update({ assignee_id: bob.userId })
      .eq("id", aliceIncident.id)
      .select("id, assignee_id");
    assert.ok(
      toSelf.error !== null ||
        (Array.isArray(toSelf.data) && toSelf.data.length === 0),
      "another team's incident must not be assignable",
    );

    // ...or to one of that team's own people, which is a valid pair for the
    // foreign key and must still be stopped by row level security.
    const toOwner = await bob.client
      .from("incidents")
      .update({ assignee_id: anna.userId })
      .eq("id", aliceIncident.id)
      .select("id, assignee_id");
    assert.ok(
      toOwner.error !== null ||
        (Array.isArray(toOwner.data) && toOwner.data.length === 0),
      "a valid assignee does not unlock another team's incident",
    );

    const { data: owner } = await alice.client
      .from("incidents")
      .select("assignee_id, updated_at")
      .eq("id", aliceIncident.id)
      .single();
    assert.equal(owner.assignee_id, null);
    assert.equal(
      owner.updated_at,
      aliceIncident.updated_at,
      "the row must not have been touched at all",
    );
  });

  it("moving a card and assigning it both leave a trail entry", async () => {
    const card = await raiseIncident(alice, "Alice cache node evicting", "P2");

    // Raising it is itself the first entry.
    let trail = await trailFor(alice, card.id);
    assert.equal(trail.length, 1, "raising an incident starts its trail");
    assert.equal(trail[0].kind, "raised");
    assert.equal(trail[0].actor_id, alice.userId);
    assert.equal(trail[0].actor_name, alice.displayName);
    assert.equal(trail[0].to_status, "triage");

    // This is exactly what a board drag does: one update, no trail write of its
    // own. Anna makes it, so the entry has to name her rather than the owner.
    const moved = await anna.client
      .from("incidents")
      .update({ status: "investigating" })
      .eq("id", card.id)
      .select("id");
    assert.equal(moved.error, null, moved.error?.message);

    trail = await trailFor(alice, card.id);
    assert.equal(trail.length, 2, "the move appended exactly one entry");
    assert.equal(trail[0].kind, "status_changed");
    assert.equal(trail[0].actor_id, anna.userId, "the entry must name the mover");
    assert.equal(trail[0].actor_name, anna.displayName);
    assert.equal(trail[0].from_status, "triage");
    assert.equal(trail[0].to_status, "investigating");

    const assigned = await alice.client
      .from("incidents")
      .update({ assignee_id: anna.userId })
      .eq("id", card.id)
      .select("id");
    assert.equal(assigned.error, null, assigned.error?.message);

    trail = await trailFor(alice, card.id);
    assert.equal(trail.length, 3);
    assert.equal(trail[0].kind, "assignment_changed");
    assert.equal(trail[0].actor_id, alice.userId);
    assert.equal(trail[0].from_assignee_id, null);
    assert.equal(trail[0].to_assignee_id, anna.userId);
    assert.equal(trail[0].to_assignee_name, anna.displayName);

    // A status change and a reassignment in one statement are two entries, and
    // `seq` orders them even though they share a timestamp.
    const both = await alice.client
      .from("incidents")
      .update({ status: "mitigating", assignee_id: null })
      .eq("id", card.id)
      .select("id");
    assert.equal(both.error, null, both.error?.message);

    trail = await trailFor(alice, card.id);
    assert.equal(trail.length, 5);
    assert.deepEqual(
      trail.map((row) => row.kind),
      [
        "assignment_changed",
        "status_changed",
        "assignment_changed",
        "status_changed",
        "raised",
      ],
    );
    assert.ok(
      trail[0].seq > trail[1].seq,
      "seq must order entries written in the same statement",
    );

    // An update that changes nothing observable adds nothing.
    await alice.client
      .from("incidents")
      .update({ status: "mitigating" })
      .eq("id", card.id)
      .select("id");
    trail = await trailFor(alice, card.id);
    assert.equal(trail.length, 5, "a no-op update must not append an entry");
  });

  it("another team's trail is unreachable", async () => {
    // Give Alice's incident a history worth stealing.
    await alice.client
      .from("incidents")
      .update({ status: "investigating", assignee_id: anna.userId })
      .eq("id", aliceIncident.id)
      .select("id");

    const mine = await trailFor(alice, aliceIncident.id);
    assert.ok(mine.length >= 3, "Alice can read her own incident's trail");

    // By incident id...
    const byIncident = await bob.client
      .from("incident_events")
      .select("*")
      .eq("incident_id", aliceIncident.id);
    assert.equal(byIncident.error, null, byIncident.error?.message);
    assert.deepEqual(byIncident.data, [], "another team's trail must not be readable");

    // ...by team id...
    const byTeam = await bob.client
      .from("incident_events")
      .select("*")
      .eq("team_id", alice.teamId);
    assert.deepEqual(byTeam.data ?? [], []);

    // ...by the exact row id...
    const byRow = await bob.client
      .from("incident_events")
      .select("*")
      .eq("id", mine[0].id);
    assert.deepEqual(byRow.data ?? [], []);

    // ...and unfiltered: Bob sees only his own team's entries, whatever they are.
    const everything = await bob.client
      .from("incident_events")
      .select("team_id");
    assert.equal(everything.error, null, everything.error?.message);
    assert.deepEqual(
      [...new Set((everything.data ?? []).map((row) => row.team_id))],
      [bob.teamId],
      "Bob's unfiltered read must contain nothing but his own team",
    );
  });

  it("the trail is append-only, even to the team that owns it", async () => {
    const trail = await trailFor(alice, aliceIncident.id);
    assert.ok(trail.length > 0);

    // No insert, update or delete is granted on the table and no policy exists
    // for any of them: only the trigger writes history.
    const planted = await alice.client
      .from("incident_events")
      .insert({
        incident_id: aliceIncident.id,
        team_id: alice.teamId,
        kind: "status_changed",
        actor_name: "Definitely Alice",
        from_status: "triage",
        to_status: "resolved",
      })
      .select();
    assert.notEqual(planted.error, null, "the trail must not accept a hand-written entry");

    const rewritten = await alice.client
      .from("incident_events")
      .update({ actor_name: "Somebody else" })
      .eq("id", trail[0].id)
      .select();
    assert.ok(
      rewritten.error !== null ||
        (Array.isArray(rewritten.data) && rewritten.data.length === 0),
      "an existing entry must not be editable",
    );

    const erased = await alice.client
      .from("incident_events")
      .delete()
      .eq("id", trail[0].id)
      .select();
    assert.ok(
      erased.error !== null ||
        (Array.isArray(erased.data) && erased.data.length === 0),
      "an existing entry must not be deletable",
    );

    const after = await trailFor(alice, aliceIncident.id);
    assert.equal(after.length, trail.length, "the trail is exactly as it was");
    assert.equal(after[0].actor_name, trail[0].actor_name);
  });

  it("an unauthenticated client reads no profiles and no trail", async () => {
    const anon = freshClient();

    for (const relation of ["profiles", "team_directory", "incident_events"]) {
      const { data, error } = await anon.from(relation).select("*");
      assert.ok(
        error !== null || (Array.isArray(data) && data.length === 0),
        `anon must not read ${relation}, got ${JSON.stringify(data)}`,
      );
    }
  });

  it("the database constrains severity and status", async () => {
    const bad = await alice.client
      .from("incidents")
      .insert({
        team_id: alice.teamId,
        title: "Bogus severity",
        severity: "P9",
        created_by: alice.userId,
      })
      .select();
    assert.notEqual(bad.error, null, "severity must be constrained in the database");

    const badStatus = await alice.client
      .from("incidents")
      .insert({
        team_id: alice.teamId,
        title: "Bogus status",
        severity: "P1",
        status: "on-fire",
        created_by: alice.userId,
      })
      .select();
    assert.notEqual(badStatus.error, null, "status must be constrained in the database");
  });
});
