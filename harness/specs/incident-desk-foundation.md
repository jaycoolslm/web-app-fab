# Spec — NOC incident desk: foundation

Build the foundation of an **incident desk**: the internal tool a managed-services operator's
network operations centre uses to raise and track incidents. This is slice 1 of three; later
slices add a kanban board and assignment/filtering on top of what you build here, so lay clean
foundations.

The repo you are in is already a Next.js (App Router, TypeScript) + Supabase scaffold with
working email/password auth under `app/auth/`, a `proxy.ts` session refresher, and shadcn/ui
components in `components/ui/`. **Build on it. Do not re-scaffold it.**

## The one property that matters

Every organisation using this tool is a **team**, and:

> A signed-in user must never be able to see, reach, or discover an incident belonging to a
> team they are not a member of — not in a list, not by guessing a URL, not through a server
> action or route handler, and not in any payload the browser receives.

Enforce this **in the database with row level security**, not only in your queries. A UI that
filters correctly on top of a permissive table is a failure of this spec: the data must be
unreachable, not merely unrendered. Use the Supabase Agent Skills available to you for RLS and
Postgres practice rather than improvising policy SQL.

## Schema

Create a migration under `supabase/migrations/` (there are none yet — this is the first) and
**apply it to the running local stack** so the app boots against a real schema.

- **`teams`** — id, name (unique), created_at.
- **`profiles`** — one row per auth user: user_id (references `auth.users`), team_id, a
  display name, created_at. This is what binds a user to their team.
- **`incidents`** — id, team_id, title, description, severity, status, created_by, created_at,
  updated_at.
  - **severity** is one of `P1`, `P2`, `P3`, `P4` — constrain it in the database, not just the UI.
  - **status** is one of `triage`, `investigating`, `mitigating`, `resolved`, defaulting to
    `triage`. Slice 2 moves incidents between these, so model it as a constrained value now.

Enable RLS on every table you create. Design the policies so the property above holds for
select, insert, update and delete alike — including that a user cannot create an incident
attributed to a team they don't belong to, or move an incident into another team.

## Onboarding and team membership

Signup must establish team membership, because a user without a team has nothing to see.

- Add a **team name** field to the existing sign-up form. On submit: join the team with that
  name if it exists, otherwise create it. Then create the user's profile against that team.
- *Deliberate simplification:* there is no invite or approval flow — team membership is
  self-declared at onboarding. Don't build one; it isn't what this programme is demonstrating.
- **Signup must land the user authenticated and inside the app.** Local Supabase has
  `enable_confirmations = false` (see `supabase/config.toml`), so a new user has a live session
  the moment they sign up — but the current form redirects to `/auth/sign-up-success`, which
  tells them to go and check an email that was never sent. That is a dead end: fix it so signup
  goes straight to the incident list. Leave the confirmation page in place for the flows that
  still legitimately use it.
- Logging out and back in must return the user to their own team's incidents, unchanged.

## The incident list

A page at **`/incidents`**, requiring authentication (unauthenticated visitors go to
`/auth/login`):

- Lists the signed-in user's team's incidents, **P1 first** then by most recently created, each
  showing title, severity, status and created-at.
- Shows which team the user is viewing, and who they are signed in as.
- A **create incident** form (title, description, severity) that adds an incident to the user's
  own team and shows it in the list without a manual reload.
- An honest **empty state** when the team has no incidents — a new team must not see a
  half-rendered table or a spinner that never resolves.
- A **detail page at `/incidents/<id>`** showing one incident in full.
- A visible **sign out** control on the page.

Make `/` link to `/incidents` so the app is navigable from the root.

## Prove the isolation property in an automated test

Write an automated test that demonstrates isolation without a browser, and wire it up as
`"test:isolation"` in `package.json` scripts so it can be run as `npm run test:isolation`. It
runs against the local Supabase stack on `127.0.0.1:54321`, and must exit non-zero when
isolation is broken.

Use Node's built-in test runner (`node --test`) and `@supabase/supabase-js`, which is already a
dependency. The shape:

- Create two teams with a user each, using unique generated emails so repeated runs don't
  collide with rows left by a previous one. **There is no service-role key in `.env`** — only
  `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — so set the fixtures up
  through the same signup path a real user takes. Don't go looking for an admin key; its absence
  is deliberate, and it means the test cannot accidentally bypass the thing it is testing.
- Sign each user in to get a **real authenticated client** for each — anon-key clients carrying
  that user's session, exactly what the browser has.
- Assert that user B's client, querying `incidents`, **cannot read** team Alpha's incident:
  neither by listing, nor by selecting it by its exact id.
- Assert that B **cannot insert** an incident attributed to team Alpha, and cannot move one of
  their own into it.
- Assert that an **unauthenticated** anon client reads nothing at all.

Keep the suite fast and self-contained: no fixtures committed to the repo, no reliance on rows
another test created, and it must pass repeatably against a stack that already has data in it.

This runs on every pass, so treat it as your own feedback loop — get it green before you hand
back, and it will tell you whether your policies really hold rather than whether your queries
happen to filter.

## Stable handles for automated driving

This app is verified by an agent driving a real browser, so give it non-brittle handles.
Playwright resolves test ids from the `data-testid` attribute — put one on each of:

`signup-team`, `incident-form`, `incident-title`, `incident-description`, `incident-severity`,
`incident-submit`, `incident-list`, `incident-row`, `incident-empty`, `current-team`,
`current-user`, `sign-out`.

Keep them stable in later slices — the Evaluator's later passes rely on them.

## How this will be judged

The Evaluator drives the running app in a real browser. It will, at minimum:

1. Sign up as user **A** with team **Alpha**, and confirm it lands authenticated on the
   incident list with an honest empty state.
2. Create a **P1** incident as A, and confirm it appears in A's list and on its detail page.
3. Sign out, then sign up as user **B** with team **Bravo** — a genuinely different team.
4. Confirm A's incident is **absent from B's list**, and that navigating B directly to
   `/incidents/<A's incident id>` does **not** disclose it (404, a redirect, or an explicit
   "not found" is fine — rendering its title is not).
5. Confirm B creating an incident does not make it visible to A.
6. Sign back in as A and confirm A's incident is still there, unchanged.
7. Using the **`supabase` MCP tools**, confirm that **every table in the `public` schema has row
   level security enabled** — a table created without it is a critical finding even if no browser
   step happened to reach it. Check this for each new table any slice of this programme adds.

Anything reachable that shouldn't be is a **critical** finding. Build and verify this yourself
in the browser before handing back — the Evaluator will find it if you don't.
