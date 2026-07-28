# Spec — NOC incident desk: assignment, filtering and activity

Slice 3 of three, and the last. Make the desk usable by a team rather than a person: incidents get
assigned, views get filtered, and changes leave a trail. Everything from slices 1 and 2 keeps
working.

## Scope

- **Assignment** — an incident can be assigned to a member of its own team, or left unassigned.
  The picker offers only the signed-in user's team, and assigning across teams is refused in the
  database. The list and the board both show the assignee, and say so plainly when there isn't one.
- **Filtering** on `/incidents` and `/board` — by severity, and by assignee including explicitly
  unassigned, with a clear-filters control. Filtered-out incidents are genuinely absent and column
  counts follow the filter. **Filter state lives in the URL**, so it survives a reload, a
  back-navigation from a detail page, and being pasted into a fresh session.
- **Activity trail** — append-only per incident: status and assignment changes, each with who and
  when, written whenever the change happens, including via a board drag. Shown newest-first on the
  detail page in plain language ("Jay moved this from Triage to Investigating"), not a raw diff.
  RLS on, and another team's trail unreachable.

## Isolation

Extend `test:isolation`: reading membership returns only the user's own team; a user cannot assign
to a profile on another team, nor assign another team's incident; another team's trail rows are
unreadable.

## Acceptance

- The assignee picker lists only the signed-in user's team, with a second team's users present in
  the database at the time.
- A severity filter removes the right incidents, counts follow, and the filter survives a reload
  and a back-navigation — **major** if it doesn't.
- Moving a card writes a trail entry naming the right person and transition.
- A user on another team can neither read that trail nor assign the incident — **critical** if
  they can.
