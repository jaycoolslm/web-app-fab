# Spec — NOC incident desk: the board

Slice 2 of three. Add the view the NOC actually lives in: a kanban board where incidents move
between states by dragging. Slice 1's behaviour, its isolation property and its test suite must
keep working.

## Scope

`/board`, authenticated, linked from `/incidents`:

- Four columns — **Triage → Investigating → Mitigating → Resolved** — holding the signed-in
  user's team's incidents as cards showing title and severity. P1 unmistakable at a glance.
  Per-column counts and empty states.
- Dragging a card to another column changes and persists that incident's status, and it is still
  there after a full page reload.
- Move the card optimistically, but return it and say so if the write is refused.
- A focusable control that moves a card between columns, for keyboard and screen-reader users.

**Implement dragging with pointer events, not the HTML5 `draggable` / `dataTransfer` API.**
Native drag-and-drop runs on the OS drag layer and ignores synthesised mouse events, so a board
built that way cannot be driven by the agent that has to sign it off.

## Isolation

The write path is new surface for slice 1's property. Whatever the drop calls must refuse to
touch another team's incident even when handed its exact id — enforced by RLS on `update`, not by
trusting the client to send only ids it can see. Running this path as anything other than the
signed-in user almost certainly breaks it.

Extend `test:isolation`: a user cannot change the status of another team's incident by id, and
the owning team sees it unchanged afterwards.

## Acceptance

- Cards sit in the column matching their status, with correct counts and P1 ordering.
- A dragged card lands in its new column and is still there after a reload — **major** if not.
- The accessible control achieves the same move.
- A user on another team sees none of these cards, and moving one by id is refused —
  **critical** if it succeeds.
