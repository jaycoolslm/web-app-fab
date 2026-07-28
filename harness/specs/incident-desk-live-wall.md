# Spec — NOC incident desk: the live wall

Slice 4. Add the screen a NOC actually puts on the wall: a view of the team's incidents that
updates itself the moment anything changes, with no reload and no polling. Everything from slices
1–3 keeps working.

## Scope

`/wall`, authenticated, linked from `/board`:

- The signed-in user's team's open incidents, laid out to be read at distance — P1 dominant,
  severity and status legible across a room, resolved work out of the way.
- **Incidents appear, change and clear themselves live.** Creating an incident, moving it between
  statuses, or assigning it updates every open wall for that team within a second or two, without
  anyone reloading. A new P1 arriving is unmissable.
- **Presence** — how many colleagues are watching the wall right now, updating as they arrive and
  leave.
- A **connection indicator** that tells the truth: live when the socket is up, and visibly
  degraded when it drops, so nobody trusts a frozen wall. Recover on reconnect.

Updates must arrive by **push over the realtime socket**. Periodically refetching on a timer is
not an implementation of this spec, and network activity will be inspected.

## Realtime design

Broadcast changes from the database to a **per-team topic**, and have each client subscribe to
its own team's topic on a **private** channel:

- A trigger on the incident tables calls `realtime.broadcast_changes` to a topic derived from the
  incident's team, so no client ever receives another team's payloads to filter out.
- Clients call `supabase.realtime.setAuth()` before subscribing — realtime authorization requires
  it.
- Authorization for joining a topic is an **RLS policy on `realtime.messages`**: a user may read a
  team's topic only if they are a member of that team. This is a separate policy surface from the
  incident tables, and it is where slice 1's property has to be re-established. A missing or loose
  policy here leaks live incident titles to anyone who can guess a topic name, while every
  existing test still passes.

Add the tables you broadcast from to the realtime publication as part of your migration.

## Isolation test

Extend `test:isolation`. Realtime is straightforward to assert here, because the suite can hold
two independent authenticated clients at once:

- A user **cannot subscribe** to another team's topic — the join is rejected.
- With one client subscribed to its own team's topic and a second team's incident being created
  and moved, the first client **receives nothing** about it.
- A user's own team's changes **do** arrive, so the test can distinguish "correctly isolated" from
  "broken and silent".

## Acceptance

Verified by an agent driving a real browser, plus the suite above.

- With `/wall` open in **two tabs as the same user** — one browser profile is one session, so do
  not try to sign a second user in alongside — an incident created or moved in one tab appears in
  the other within a couple of seconds, with no reload.
- The presence count reflects both tabs, and drops when one closes.
- Network activity shows updates arriving over a **websocket**, not a repeating fetch on a timer —
  a polling implementation is a **major** finding.
- The connection indicator reports degraded when the socket is interrupted, and recovers.
- `get_advisors` (`type: "security"`) comes back clean, including for `realtime.messages`.
