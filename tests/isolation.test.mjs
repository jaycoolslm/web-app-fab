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

/** Signs up a brand new user on a brand new team and returns their session client. */
async function signUpOnNewTeam(label) {
  const suffix = randomUUID();
  const client = freshClient();

  const { data, error } = await client.auth.signUp({
    email: `${label}-${suffix}@example.com`,
    password: PASSWORD,
    options: { data: { team_name: `${label}-team-${suffix}` } },
  });
  assert.equal(error, null, `signup failed for ${label}: ${error?.message}`);
  assert.ok(data.session, `signup for ${label} produced no session`);

  // Membership is established by the signup trigger; reading it back through
  // the user's own session also proves they can see their own team.
  const { data: memberships, error: membershipError } = await client
    .from("team_members")
    .select("team_id");
  assert.equal(membershipError, null, membershipError?.message);
  assert.equal(memberships.length, 1, `${label} should belong to exactly one team`);

  return { client, userId: data.user.id, teamId: memberships[0].team_id };
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
  /** @type {Awaited<ReturnType<typeof signUpOnNewTeam>>} */
  let bob;
  let aliceIncident;
  let bobIncident;

  before(async () => {
    alice = await signUpOnNewTeam("alice");
    bob = await signUpOnNewTeam("bob");

    assert.notEqual(alice.teamId, bob.teamId, "fixtures must be on different teams");

    aliceIncident = await raiseIncident(alice, "Alice core router flapping", "P1");
    bobIncident = await raiseIncident(bob, "Bob edge switch degraded", "P3");
  });

  after(async () => {
    await alice?.client.auth.signOut();
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
