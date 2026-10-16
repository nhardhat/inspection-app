import { useEffect, useRef, useState, type RefObject } from "react";

/** How long a page is held before it lifts to be dragged. */
export const HOLD_MS = 400;
/** Moving further than this before then is a scroll, not a hold. */
const HOLD_SLOP = 10;
/** Near the top or bottom of the list it scrolls while dragging. */
const EDGE = 60;

/** A page in the Pages view that can be dragged or dropped on. */
export interface DragEntry {
  key: string;
  drawingId: string;
  drawingName: string;
  /** 1-based position in its drawing's pages. */
  position: number;
  /** Number through the document. */
  number: number;
}

/** Where a dragged page would land: beside a page, before or after it. */
export interface DropTarget {
  key: string;
  side: "before" | "after";
  label: string;
  drawingId: string;
  /** 1-based position in that drawing's pages once moved. */
  toPosition: number;
}

export interface PageDragState {
  key: string;
  /** Pointer position (screen px), where the lifted page follows. */
  x: number;
  y: number;
  target: DropTarget | null;
}

/** Where `entry` would land beside `over`, or null for no move. */
export function dropTarget(
  entry: DragEntry,
  over: DragEntry,
  side: "before" | "after",
): DropTarget | null {
  let toPosition = over.position + (side === "after" ? 1 : 0);
  if (over.drawingId === entry.drawingId) {
    // Its own drawing: places count once it has left its old one.
    if (toPosition > entry.position) toPosition -= 1;
    if (toPosition === entry.position) return null;
  }
  return {
    key: over.key,
    side,
    drawingId: over.drawingId,
    toPosition,
    label: `Move to ${over.drawingName}, ${side} page ${over.number}`,
  };
}

/**
 * Hold a page in the Pages view, then drag it anywhere, even into another
 * drawing (engineer, 2026-10-16). A short hold lifts it (moving first is a
 * scroll); the page under the finger shows where it would go, before or
 * after it by which half the finger is over; the list scrolls near its top
 * and bottom; letting go calls `onDrop`. Cells carry `data-drag-key`.
 */
export function usePageDrag(
  entries: DragEntry[],
  scroller: RefObject<HTMLElement | null>,
  onDrop: (entry: DragEntry, target: DropTarget) => void,
  enabled: boolean,
) {
  const [drag, setDragState] = useState<PageDragState | null>(null);
  const dragRef = useRef<PageDragState | null>(null);
  const latest = useRef({ entries, onDrop });
  useEffect(() => {
    latest.current = { entries, onDrop };
  });
  /** A drag just ended: the page's click (go to page) is ignored. */
  const justDragged = useRef(false);

  const setDrag = (next: PageDragState | null) => {
    dragRef.current = next;
    setDragState(next);
  };

  // While dragging, touch moves don't scroll the list (iOS).
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const stop = (e: TouchEvent) => {
      if (dragRef.current) e.preventDefault();
    };
    el.addEventListener("touchmove", stop, { passive: false });
    return () => el.removeEventListener("touchmove", stop);
  }, [scroller]);

  function targetAt(key: string, x: number, y: number): DropTarget | null {
    const { entries } = latest.current;
    const entry = entries.find((e) => e.key === key);
    const cells =
      scroller.current?.querySelectorAll<HTMLElement>("[data-drag-key]");
    if (!entry || !cells) return null;
    for (const cell of cells) {
      const box = cell.getBoundingClientRect();
      if (x < box.left || x > box.right || y < box.top || y > box.bottom)
        continue;
      const over = entries.find((e) => e.key === cell.dataset.dragKey);
      if (!over || over.key === entry.key) return null;
      return dropTarget(
        entry,
        over,
        x < box.left + box.width / 2 ? "before" : "after",
      );
    }
    return dragRef.current?.target ?? null;
  }

  function pointerDown(key: string, e: React.PointerEvent) {
    if (!enabled || e.button !== 0) return;
    const start = { x: e.clientX, y: e.clientY };
    const pointerId = e.pointerId;
    let lifted = false;
    let last = start;
    let frame = 0;
    const timer = window.setTimeout(() => {
      lifted = true;
      setDrag({ key, ...last, target: null });
      frame = requestAnimationFrame(autoScroll);
    }, HOLD_MS);

    // Near an edge the list scrolls; the target follows.
    const autoScroll = () => {
      const el = scroller.current;
      const d = dragRef.current;
      if (!el || !d) return;
      const box = el.getBoundingClientRect();
      const step =
        d.y < box.top + EDGE ? -12 : d.y > box.bottom - EDGE ? 12 : 0;
      if (step) {
        el.scrollTop += step;
        setDrag({ ...d, target: targetAt(key, d.x, d.y) });
      }
      frame = requestAnimationFrame(autoScroll);
    };

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      last = { x: ev.clientX, y: ev.clientY };
      if (!lifted) {
        if (Math.hypot(last.x - start.x, last.y - start.y) > HOLD_SLOP) end();
        return;
      }
      ev.preventDefault();
      setDrag({ key, ...last, target: targetAt(key, last.x, last.y) });
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const d = dragRef.current;
      const entry = latest.current.entries.find((x) => x.key === key);
      end();
      if (!lifted) return;
      justDragged.current = true;
      window.setTimeout(() => (justDragged.current = false), 0);
      if (ev.type === "pointerup" && d?.target && entry)
        latest.current.onDrop(entry, d.target);
    };
    const end = () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (lifted) setDrag(null);
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  return {
    drag,
    pointerDown,
    /** True just after a drag: the page's own click should do nothing. */
    wasDragged: () => justDragged.current,
  };
}
