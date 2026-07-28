# Spec — NOC incident desk: foundation

Slice 1 of three. Build the foundation of an **incident desk**: the internal tool a
managed-services operator's network operations centre uses to raise and track incidents. Later
slices add a kanban board, then assignment and filtering.

The repo is already a Next.js (App Router, TypeScript) + Supabase scaffold with working
email/password auth under `app/auth/`, session refresh in `proxy.ts`, and shadcn/ui components.
Build on it; don't re-scaffold it.

## The property that matters

Every organisation using the desk is a **team**.

> A signed-in user must never see, reach or discover an incident belonging to a team they are not
> a member of — not in a list, not by URL, not through a server action, not in any payload the
> browser receives.

Enforce it in the database with row level security, not in your queries: a UI that filters
correctly over a permissive table fails this spec. The data must be unreachable, not unrendered.

## Scope

- **Schema** — teams, per-user team membership, and incidents carrying a severity (P1–P4) and a
  status (`triage`, `investigating`, `mitigating`, `resolved`). Constrain severity and status in
  the database. Migration under `supabase/migrations/`, applied to the running local stack.
- **Onboarding** — signup establishes team membership: a team name that joins the named team or
  creates it, with no invite or approval flow. Signup must land the user authenticated inside the
  app. Local Supabase has `enable_confirmations = false`, so the session is live immediately, but
  the scaffold redirects to `/auth/sign-up-success` and tells them to check an email that was
  never sent — fix that path, and leave the page for the flows that still use it.
- **`/incidents`** — the signed-in user's team's incidents, P1 first; a create form; an honest
  empty state; a detail page per incident; sign out. Link `/` to it.

Give interactive elements stable `data-testid` attributes and keep them stable across later
slices — an agent drives this app in a browser.

## Isolation test

Add `"test:isolation"` to `package.json` scripts; it runs on every pass. Use Node's test runner
and `@supabase/supabase-js` against the local stack, and keep it runnable with only the env vars
in `.env.example`.

Set up two teams with a user each, using unique generated emails so repeat runs don't collide.
The **assertions must run through real signed-in user sessions, never a service-role key** — that
key bypasses row level security, so the suite would report green against tables with no policies
at all. Cover: a user cannot read another team's incident by list or by id, cannot insert one
attributed to another team, cannot move their own into one, and an unauthenticated client reads
nothing.

## Acceptance

Verified by an agent driving a real browser and the `supabase` MCP tools.

- Two users on **different** teams each see only their own team's incidents — absent from the
  list, and undisclosed at `/incidents/<id>`. A 404, redirect or explicit not-found is fine;
  rendering the title is a **critical** finding.
- An incident survives sign-out and sign-in.
- `get_advisors` (`type: "security"`) comes back clean for every table this programme creates.
