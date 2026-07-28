# Spec — NOC incident desk: the board

Slice 2 of three. Add the view the NOC actually lives in: a **kanban board** where incidents
move between states by dragging. Everything slice 1 established — auth, team membership, RLS,
the incident list, its `data-testid` handles — must keep working exactly as it did.

## The board

A page at **`/board`**, authenticated, linked from `/incidents` (and linking back):

- Four columns in this order: **Triage → Investigating → Mitigating → Resolved**, matching the
  `status` values from slice 1.
- Each incident in the signed-in user's team appears as a **card** in its status column,
  showing title and a severity badge. **P1 must be visually unmistakable** — a NOC lead should
  spot it across the room.
- Within a column, cards sort **P1 first**, then most recently updated.
- Each column shows a **count** of the cards in it, and an honest empty state when it has none.
- Dragging a card into another column **changes that incident's status and persists it**. After
  a full page reload the card is still in its new column. `updated_at` moves with it.

## Implement drag with pointer events, not the HTML5 drag-and-drop API

Use pointer/mouse-event based dragging (`pointerdown`/`pointermove`/`pointerup`, or a library
built on them such as `@dnd-kit`). **Do not** use the native HTML5 `draggable` +
`dragstart`/`drop` + `dataTransfer` API.

This is a hard requirement, and the reason is the loop you are running inside: this app is
verified by an agent driving a real browser, which synthesises drags as mouse press → move →
release. Native HTML5 drag-and-drop is driven by the OS drag layer and does not respond to
synthesised mouse events, so a board built that way is untestable by the thing that has to sign
it off — however well it works under a human hand.

Also make status changes reachable **without** a drag, for keyboard and screen-reader users:
each card needs a focusable control that moves it between columns. Build both; the drag is the
primary interaction, the accessible control is the equivalent.

## Optimistic updates must reconcile

Move the card immediately on drop rather than waiting for the round trip — but if the write
fails or is refused, the card must **return to the column it came from** and the user must be
told. A card that stays where it was dropped while the database disagrees is a critical failure:
the next reload silently contradicts the screen.

## Isolation still holds — including on the write path

Slice 1's property is unchanged and now has a new surface to defend. Whatever server action or
route handler the drop calls **must refuse to touch an incident belonging to another team**,
even when handed its exact id. Do not rely on the client only ever sending ids it can see:

- The board must show only the signed-in user's team's incidents.
- A mutation naming another team's incident id must be **refused** — not silently applied, and
  not applied-then-hidden. Rejection must hold at the database level, so verify your RLS
  policies cover `update`, not just `select`.

If you reach for an admin or service-role client anywhere on this path, you have almost
certainly broken this property — the request must run as the signed-in user.

## Extend the isolation test suite

`npm run test:isolation` from slice 1 must still pass, and must now also cover the write path
this slice opens up. Add cases asserting that a user's authenticated client **cannot** change the
`status` of an incident belonging to another team when handed its exact id — the update must be
refused or affect zero rows, and a follow-up read as the owning team must confirm the status is
unchanged. Keep using real authenticated clients, never a service role.

## Stable handles

Keep slice 1's `data-testid` values working, and add: `board`, `board-column-triage`,
`board-column-investigating`, `board-column-mitigating`, `board-column-resolved`,
`incident-card`, `column-count`, `card-move` (the accessible move control), and
`board-error` (where a refused or failed move is reported).

Each `incident-card` must expose its incident id in a `data-incident-id` attribute so a specific
card can be found without depending on its title.

## How this will be judged

The Evaluator drives the running app in a real browser. It will, at minimum:

1. Sign in as a user with incidents, open `/board`, and confirm each card sits in the column
   matching its status, with correct counts and P1 ordering.
2. **Drag a card** from Triage into Investigating, confirm it lands there, then **reload the
   page** and confirm it is still there.
3. Confirm the same move is achievable through the accessible `card-move` control.
4. Sign in as a **second user on a different team** and confirm none of the first team's cards
   appear on their board.
5. Attempt, as that second user, to move an incident belonging to the first team by its id, and
   confirm it is **refused** — then sign back in as the first user and confirm the incident's
   status never changed.

A cross-team write that succeeds is a **critical** finding. A move that appears to work but
does not survive a reload is a **major** one. Drive the board in a browser yourself before
handing back.
