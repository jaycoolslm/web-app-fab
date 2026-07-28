"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { moveIncident } from "@/app/board/actions";
import { Badge } from "@/components/ui/badge";
import {
  compareForBoard,
  nextStatus,
  previousStatus,
  SEVERITY_ACCENT_CLASS,
  SEVERITY_CHIP_CLASS,
  STATUS_ACCENT_CLASS,
  STATUS_LABELS,
  STATUSES,
  type BoardCard,
  type IncidentStatus,
} from "@/lib/incidents";
import { cn } from "@/lib/utils";

/** Pointer travel, in px, before a press becomes a drag rather than a click. */
const DRAG_THRESHOLD_PX = 4;

/** How far outside a column a release still counts as landing in it. */
const GUTTER_SLACK_PX = 24;

type DragState = {
  cardId: string;
  from: IncidentStatus;
  pointerId: number;
  /** Where inside the card the pointer grabbed it, so the ghost sits right. */
  grabX: number;
  grabY: number;
  width: number;
  height: number;
  /** Pointer position at pointerdown, for the threshold test. */
  originX: number;
  originY: number;
  /** Live pointer position. */
  x: number;
  y: number;
  /** True once the pointer has travelled past DRAG_THRESHOLD_PX. */
  moved: boolean;
  over: IncidentStatus | null;
};

export function IncidentBoard({
  incidents,
  teamName,
}: {
  incidents: BoardCard[];
  teamName: string;
}) {
  /**
   * Optimistic layer over the server's data rather than a copy of it. An entry
   * means "the user has asked for this card to be here"; the server props stay
   * the source of truth underneath, so a refusal only has to drop the entry for
   * the card to snap back to where the database says it is.
   */
  const [overrides, setOverrides] = useState<
    Record<string, IncidentStatus | undefined>
  >({});
  const [pending, setPending] = useState<Record<string, true | undefined>>({});
  const [refusal, setRefusal] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const [drag, setDragState] = useState<DragState | null>(null);
  // Mirrored into a ref so the window-level pointer handlers can read the
  // current drag synchronously instead of closing over a stale render.
  const dragRef = useRef<DragState | null>(null);
  const setDrag = useCallback((next: DragState | null) => {
    dragRef.current = next;
    setDragState(next);
  }, []);

  const columnRefs = useRef<Partial<Record<IncidentStatus, HTMLDivElement>>>({});
  /**
   * A card's title is a link to its detail page, and grabbing a card by its
   * title is the obvious thing to do. So the link is a legitimate drag handle,
   * and this flag swallows the click that a completed drag would otherwise
   * deliver to it.
   */
  const justDraggedRef = useRef(false);

  // Once the server confirms a move, its override says the same thing the props
  // do and can go. Anything still in flight is left alone.
  useEffect(() => {
    setOverrides((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const incident of incidents) {
        if (next[incident.id] === incident.status) {
          delete next[incident.id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [incidents]);

  const cards = useMemo(
    () =>
      incidents.map((incident) => ({
        ...incident,
        status: overrides[incident.id] ?? incident.status,
      })),
    [incidents, overrides],
  );

  const columns = useMemo(
    () =>
      STATUSES.map((status) => ({
        status,
        cards: cards
          .filter((card) => card.status === status)
          .sort(compareForBoard),
      })),
    [cards],
  );

  const cardsById = useMemo(
    () => new Map(cards.map((card) => [card.id, card])),
    [cards],
  );

  const commitMove = useCallback(
    (card: BoardCard, to: IncidentStatus) => {
      const from = card.status;
      if (from === to) return;

      // Optimistic: the card is in its new column before the request leaves.
      setOverrides((prev) => ({ ...prev, [card.id]: to }));
      setPending((prev) => ({ ...prev, [card.id]: true }));
      setRefusal(null);
      setAnnouncement(`Moving ${card.title} to ${STATUS_LABELS[to]}.`);

      const done = () =>
        setPending((prev) => {
          const next = { ...prev };
          delete next[card.id];
          return next;
        });

      /**
       * Put the card back where this move picked it up from. Pinning it to
       * `from` rather than deleting the override matters when an earlier move on
       * the same card is still settling: the props underneath can be a step
       * behind, and dropping to them would rewind two moves instead of one.
       */
      const putBack = (reason: string) => {
        setOverrides((prev) => ({ ...prev, [card.id]: from }));
        const message = `Could not move “${card.title}” to ${STATUS_LABELS[to]} — ${reason} Put back in ${STATUS_LABELS[from]}.`;
        setRefusal(message);
        setAnnouncement(message);
      };

      void moveIncident(card.id, to).then(
        (result) => {
          done();
          if (result.ok) {
            setAnnouncement(`${card.title} moved to ${STATUS_LABELS[to]}.`);
          } else {
            putBack(result.error);
          }
        },
        (error: unknown) => {
          done();
          console.error("[board] move failed:", error);
          putBack("the desk could not be reached.");
        },
      );
    },
    [],
  );

  /** Which column, if any, this viewport point should drop into. */
  const columnAt = useCallback((x: number, y: number): IncidentStatus | null => {
    const rects: { status: IncidentStatus; rect: DOMRect }[] = [];
    for (const status of STATUSES) {
      const element = columnRefs.current[status];
      if (element) rects.push({ status, rect: element.getBoundingClientRect() });
    }

    for (const { status, rect } of rects) {
      if (
        x >= rect.left &&
        x <= rect.right &&
        y >= rect.top &&
        y <= rect.bottom
      ) {
        return status;
      }
    }

    // Released in the gutter between two columns rather than on one. Snap to
    // whichever is nearer instead of silently doing nothing, which is what a
    // drag that misses by a few pixels would otherwise look like.
    let nearest: IncidentStatus | null = null;
    let shortest = Infinity;
    for (const { status, rect } of rects) {
      if (y < rect.top || y > rect.bottom) continue;
      const gap =
        x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
      if (gap < shortest) {
        shortest = gap;
        nearest = status;
      }
    }
    return shortest <= GUTTER_SLACK_PX ? nearest : null;
  }, []);

  /**
   * Pointer events, not the HTML5 drag API. Native drag-and-drop is handled by
   * the OS drag layer, which never sees synthesised input — a board built on it
   * cannot be driven by a test or an agent. These listeners live on the window
   * so the drag survives the pointer leaving the card.
   */
  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const current = dragRef.current;
      if (!current || event.pointerId !== current.pointerId) return;

      const moved =
        current.moved ||
        Math.abs(event.clientX - current.originX) > DRAG_THRESHOLD_PX ||
        Math.abs(event.clientY - current.originY) > DRAG_THRESHOLD_PX;

      if (moved && event.cancelable) event.preventDefault();

      setDrag({
        ...current,
        x: event.clientX,
        y: event.clientY,
        moved,
        over: moved ? columnAt(event.clientX, event.clientY) : null,
      });
    };

    const onPointerUp = (event: PointerEvent) => {
      const current = dragRef.current;
      if (!current || event.pointerId !== current.pointerId) return;

      setDrag(null);
      if (!current.moved) return;
      justDraggedRef.current = true;

      // Hit-test at the release point rather than trusting the last move.
      const target = columnAt(event.clientX, event.clientY);
      const card = cardsById.get(current.cardId);
      if (card && target && target !== current.from) {
        commitMove(card, target);
      }
    };

    const onPointerCancel = () => setDrag(null);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dragRef.current) setDrag(null);
    };

    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [cardsById, columnAt, commitMove, setDrag]);

  // Suppress text selection for the duration of a drag.
  useEffect(() => {
    if (!drag?.moved) return;
    const previous = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.userSelect = previous;
    };
  }, [drag?.moved]);

  const onCardPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, card: BoardCard) => {
      // Cleared first so a press that starts no drag — on a move button, say —
      // still gets its click through.
      justDraggedRef.current = false;

      // Primary button / single touch only, and never from a nested control.
      if (event.button !== 0) return;
      if ((event.target as HTMLElement).closest("button,input,select,textarea")) {
        return;
      }

      const rect = event.currentTarget.getBoundingClientRect();
      setDrag({
        cardId: card.id,
        from: card.status,
        pointerId: event.pointerId,
        grabX: event.clientX - rect.left,
        grabY: event.clientY - rect.top,
        width: rect.width,
        height: rect.height,
        originX: event.clientX,
        originY: event.clientY,
        x: event.clientX,
        y: event.clientY,
        moved: false,
        over: null,
      });
    },
    [setDrag],
  );

  /** A drag that ended on the title link must not also follow the link. */
  const onCardClickCapture = useCallback((event: React.MouseEvent) => {
    if (!justDraggedRef.current) return;
    justDraggedRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const draggingCard = drag?.moved ? cardsById.get(drag.cardId) : undefined;

  return (
    <div className="flex flex-col gap-4" data-testid="board">
      {refusal && (
        <p
          role="alert"
          className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400"
          data-testid="board-refusal"
        >
          {refusal}
        </p>
      )}

      {/* Every move is narrated here for anyone not watching the columns. */}
      <p
        aria-live="polite"
        role="status"
        className="sr-only"
        data-testid="board-announcer"
      >
        {announcement}
      </p>

      <div
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        data-testid="board-columns"
      >
        {columns.map((column) => {
          const isDropTarget =
            drag?.moved === true &&
            drag.over === column.status &&
            drag.from !== column.status;

          return (
            <div
              key={column.status}
              ref={(element) => {
                if (element) columnRefs.current[column.status] = element;
                else delete columnRefs.current[column.status];
              }}
              data-testid={`board-column-${column.status}`}
              data-status={column.status}
              data-drop-target={isDropTarget ? "true" : undefined}
              aria-label={`${STATUS_LABELS[column.status]}, ${column.cards.length} ${
                column.cards.length === 1 ? "incident" : "incidents"
              }`}
              className={cn(
                "flex flex-col rounded-lg border transition-colors",
                STATUS_ACCENT_CLASS[column.status],
                isDropTarget && "border-primary ring-2 ring-primary",
              )}
            >
              <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
                <h2 className="text-sm font-semibold">
                  {STATUS_LABELS[column.status]}
                </h2>
                <span
                  className="rounded-full bg-foreground/10 px-2 py-0.5 text-xs font-medium tabular-nums"
                  data-testid={`board-count-${column.status}`}
                >
                  {column.cards.length}
                </span>
              </div>

              <ul
                className="flex min-h-[8rem] flex-1 flex-col gap-2 p-2"
                data-testid={`board-list-${column.status}`}
              >
                {column.cards.length === 0 ? (
                  <li
                    className="flex flex-1 items-center justify-center rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground"
                    data-testid={`board-empty-${column.status}`}
                  >
                    {column.status === "triage"
                      ? "Nothing waiting to be triaged."
                      : `Nothing ${STATUS_LABELS[column.status].toLowerCase()}. Drag a card here.`}
                  </li>
                ) : (
                  column.cards.map((card) => (
                    <BoardCardItem
                      key={card.id}
                      card={card}
                      isDragging={drag?.cardId === card.id && drag.moved}
                      isPending={pending[card.id] === true}
                      onPointerDown={onCardPointerDown}
                      onClickCapture={onCardClickCapture}
                      onMove={commitMove}
                    />
                  ))
                )}
              </ul>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground" data-testid="board-hint">
        Drag a card into another column to change its status, or tab to its ‹ ›
        buttons and move it from the keyboard. Changes are saved against{" "}
        {teamName} as you make them.
      </p>

      {/* The card that follows the pointer. Inert, so it never eats a hit test. */}
      {drag && draggingCard && (
        <div
          className="pointer-events-none fixed z-50 opacity-90"
          style={{
            left: drag.x - drag.grabX,
            top: drag.y - drag.grabY,
            width: drag.width,
          }}
          data-testid="board-drag-ghost"
          aria-hidden="true"
        >
          <CardFace card={draggingCard} className="rotate-2 shadow-xl" />
        </div>
      )}
    </div>
  );
}

/** The visual card, shared by the real card and the drag ghost. */
function CardFace({
  card,
  className,
}: {
  card: BoardCard;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-l-4 bg-background p-2.5 shadow-sm",
        SEVERITY_ACCENT_CLASS[card.severity],
        card.severity === "P1" && "ring-1 ring-red-500/40",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug">{card.title}</p>
        <Badge
          className={cn("shrink-0", SEVERITY_CHIP_CLASS[card.severity])}
          data-testid="board-card-severity"
        >
          {card.severity}
        </Badge>
      </div>
    </div>
  );
}

function BoardCardItem({
  card,
  isDragging,
  isPending,
  onPointerDown,
  onClickCapture,
  onMove,
}: {
  card: BoardCard;
  isDragging: boolean;
  isPending: boolean;
  onPointerDown: (
    event: React.PointerEvent<HTMLDivElement>,
    card: BoardCard,
  ) => void;
  onClickCapture: (event: React.MouseEvent) => void;
  onMove: (card: BoardCard, to: IncidentStatus) => void;
}) {
  const previous = previousStatus(card.status);
  const next = nextStatus(card.status);

  return (
    <li data-testid={`board-card-${card.id}`}>
      <div
        onPointerDown={(event) => onPointerDown(event, card)}
        onClickCapture={onClickCapture}
        /*
         * The browser wants to native-drag the title anchor the moment you press
         * it, and a native drag runs on the OS drag layer where our pointer
         * events never arrive. Refusing dragstart keeps the whole card on the
         * pointer-event path no matter where it was grabbed.
         */
        onDragStart={(event) => event.preventDefault()}
        draggable={false}
        data-testid={`board-card-surface-${card.id}`}
        data-incident-id={card.id}
        data-status={card.status}
        data-severity={card.severity}
        data-pending={isPending ? "true" : undefined}
        // touch-action:none keeps a touch drag from turning into a page scroll.
        className={cn(
          "touch-none select-none rounded-md border border-l-4 bg-background p-2.5 shadow-sm transition-opacity",
          "cursor-grab active:cursor-grabbing hover:bg-accent/40",
          SEVERITY_ACCENT_CLASS[card.severity],
          card.severity === "P1" && "ring-1 ring-red-500/40",
          isDragging && "opacity-30",
          isPending && "opacity-70",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <Link
            href={`/incidents/${card.id}`}
            draggable={false}
            className="text-sm font-medium leading-snug hover:underline"
            data-testid={`board-card-link-${card.id}`}
          >
            {card.title}
          </Link>
          <Badge
            className={cn("shrink-0", SEVERITY_CHIP_CLASS[card.severity])}
            data-testid={`board-card-severity-${card.id}`}
          >
            {card.severity}
          </Badge>
        </div>

        {/*
          The keyboard and screen-reader route to the same move the drag makes.
          Real buttons with spelled-out names, not an icon and a tooltip.
        */}
        <div className="mt-2 flex items-center justify-end gap-1">
          {isPending && (
            <span
              className="mr-auto text-[11px] text-muted-foreground"
              data-testid={`board-card-saving-${card.id}`}
            >
              Saving…
            </span>
          )}
          <MoveButton
            card={card}
            to={previous}
            direction="left"
            onMove={onMove}
          />
          <MoveButton card={card} to={next} direction="right" onMove={onMove} />
        </div>
      </div>
    </li>
  );
}

function MoveButton({
  card,
  to,
  direction,
  onMove,
}: {
  card: BoardCard;
  to: IncidentStatus | null;
  direction: "left" | "right";
  onMove: (card: BoardCard, to: IncidentStatus) => void;
}) {
  const label = to
    ? `Move “${card.title}” to ${STATUS_LABELS[to]}`
    : `“${card.title}” cannot move ${direction === "left" ? "left" : "right"}`;

  return (
    <button
      type="button"
      disabled={!to}
      onClick={() => to && onMove(card, to)}
      aria-label={label}
      title={label}
      data-testid={`board-move-${direction === "left" ? "prev" : "next"}-${card.id}`}
      className={cn(
        "rounded border px-1.5 py-0.5 text-xs leading-none transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        to
          ? "hover:bg-accent"
          : "cursor-not-allowed border-transparent opacity-30",
      )}
    >
      <span aria-hidden="true">{direction === "left" ? "‹" : "›"}</span>
    </button>
  );
}
