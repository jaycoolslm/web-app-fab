# Spec — NOC incident desk: assignment, filtering and the activity trail

Slice 3 of three, and the last. Make the desk usable by a team rather than a person: incidents
get **assigned** to an engineer, the board and list can be **filtered**, and every change leaves
an **activity trail**. Everything from slices 1 and 2 — auth, RLS isolation, the list, the board,
its drag behaviour and all existing `data-testid` handles — must keep working.

## Assignment

- An incident can be assigned to **a member of its own team**, or left unassigned. Model the
  assignee as a nullable reference to a profile and migrate it in; keep RLS on.
- The assignee picker on the incident detail page (and on a board card) must offer **only
  members of the signed-in user's team**. This is the same isolation property as slice 1 applied
  to people rather than incidents: another team's engineer names must not be reachable, which
  means your `profiles` policies have to restrict select to same-team rows, not just to the
  signed-in user's own row.
- Assigning must be **refused** if the target profile is on a different team, at the database
  level, even when handed a valid profile id directly.
- The list and the board both show who an incident is assigned to, and say so plainly when
  nothing is assigned.

## Filtering that survives the browser

Both `/incidents` and `/board` get filters:

- **By severity** — one or more of P1–P4.
- **By assignee** — a specific team member, or explicitly *unassigned*.
- A **clear filters** control that returns to the unfiltered view.
- Filtered-away incidents must be genuinely absent, and the board's column counts must reflect
  the filter rather than the unfiltered totals.

**Filter state must live in the URL as query parameters**, not only in component state. This is
the requirement, and it is worth stating why: a filter kept in React state alone looks perfect
in every unit test and every code review, then quietly resets the moment the user reloads,
shares the link, or navigates to an incident and presses back. That is a bug only a browser can
see, and it will be looked for. Concretely:

- Applying a filter updates the URL.
- **Reloading** the page keeps the filter applied, with the controls still showing it as active.
- Navigating to an incident detail page and going **back** keeps the filter applied.
- Pasting a filtered URL into a fresh session (after signing in) reproduces the same filtered view.

## The activity trail

Every incident records what happened to it:

- An append-only trail capturing at least **status changes** (from → to) and **assignment
  changes** (from → to), each with **who** made the change and **when**.
- Entries are written whenever the change happens — including a status change made by dragging
  a card on the board, which must produce a trail entry exactly as an explicit edit does.
- The incident detail page shows the trail newest-first, in plain language a NOC lead can read
  ("Jay moved this from Triage to Investigating"), not a raw diff.
- The trail is a new table: **enable RLS on it**, and make sure another team's trail is
  unreachable. A trail that leaks tells an outsider your incident titles, your staff names and
  your response times.

## Extend the isolation test suite

`npm run test:isolation` must still pass and must now cover the two surfaces this slice adds.
With two teams and users on each set up, assert with real authenticated clients that a user:

- reading `profiles` sees **only their own team's members** — this is the picker leak, and it is
  the easiest mistake in this slice to make and the hardest to see by eye;
- **cannot assign** an incident to a profile on another team, nor assign another team's incident
  to anyone;
- **cannot read** another team's activity trail rows, by listing or by incident id.

## Stable handles

Keep every earlier `data-testid` working, and add: `assignee-select`, `assignee-option`,
`assignee-display`, `filter-severity`, `filter-assignee`, `filter-clear`, `activity-trail`,
`activity-entry`.

## How this will be judged

The Evaluator drives the running app in a real browser. It will, at minimum:

1. Sign in, assign an incident to a **teammate**, and confirm the assignee shows on the detail
   page, in the list and on the board.
2. Open the assignee picker and confirm it lists **only** the signed-in user's team — with a
   second team's users existing in the database at the time.
3. Apply a severity filter, confirm the right incidents disappear and the column counts follow,
   then **reload** and confirm the filter is still applied and still shown as active.
4. Open an incident from a filtered list, press **back**, and confirm the filter survived.
5. Move a card on the board and confirm a **new activity entry** naming the right person and the
   right transition appears on that incident.
6. As a user on a **different team**, confirm they cannot read that incident's activity trail and
   cannot assign it to anyone.

A picker or trail that discloses another team is a **critical** finding. A filter that does not
survive a reload or a back-navigation is a **major** one. Exercise all of it in a browser
yourself — reloads and back-navigation included — before handing back.
