import { useEffect, useRef, useState } from "react";
import type { BoxTextSize, ObservationBox } from "../../db/types";
import {
  boxMetrics,
  boxWidthFraction,
  boxWidthLimits,
  clampBoxPosition,
  type BoxLine,
} from "./observationBox";
import type { Point } from "./viewer/viewTransform";
import { useViewerCoords } from "./viewer/viewerCoords";

/** What a change to the box sets: where it is, its width and text size. */
export type BoxChange = Pick<ObservationBox, "x" | "y" | "width" | "textSize">;

interface Props {
  box: ObservationBox;
  /** From boxLines(): header, then observation and instruction sections. */
  lines: BoxLine[];
  /** A move, resize or text size change, as the box's new values. */
  onChange: (to: BoxChange, label: string) => void;
}

const SIZES: BoxTextSize[] = ["S", "M", "L"];

/** Movement (page fraction) below which a press counts as a tap. */
const TAP = 0.002;

type Drag =
  | { kind: "move"; pointerId: number; offset: Point; moved: boolean }
  | { kind: "left" | "right"; pointerId: number };

/**
 * The notes box (instructions and observations), drawn on the page in page
 * units so it zooms with the drawing and matches the exported PDF. Drag it
 * to move it off detail. A tap selects it (engineer, 2026-10-20): a handle
 * on each side drags its width (the text re-wraps, the height follows) and
 * a bar above sets the text size, S, M or L. A tap elsewhere lets go.
 */
export function ObservationBoxOverlay({ box, lines, onChange }: Props) {
  const { pageSize, clientToNormalised } = useViewerCoords();
  const [preview, setPreview] = useState<BoxChange | null>(null);
  const [selected, setSelected] = useState(false);
  const shown: BoxChange = preview ?? box;
  const m = boxMetrics(pageSize, shown);
  const drag = useRef<Drag | null>(null);
  const latest = useRef<BoxChange>(shown);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    latest.current = shown;
  });
  /** Shows new values while dragging (and for the handlers straight away). */
  function show(to: BoxChange) {
    latest.current = to;
    setPreview(to);
  }

  // A press anywhere else lets go of it.
  useEffect(() => {
    if (!selected) return;
    const away = (e: PointerEvent) => {
      if (!host.current?.contains(e.target as Node)) setSelected(false);
    };
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  }, [selected]);

  const values = (b: BoxChange): BoxChange => ({
    x: b.x,
    y: b.y,
    width: b.width,
    textSize: b.textSize,
  });

  function commit(to: BoxChange, label: string) {
    const same =
      to.x === box.x &&
      to.y === box.y &&
      to.width === box.width &&
      to.textSize === box.textSize;
    if (!same) onChange(values(to), label);
    // Keep showing the new values until the saved ones arrive.
    setTimeout(() => setPreview(null), 300);
  }

  function capture(e: React.PointerEvent) {
    e.stopPropagation();
    if (e.pointerType === "mouse") e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Pointer already released.
    }
  }

  function onPointerDown(e: React.PointerEvent) {
    capture(e);
    const at = clientToNormalised(e.clientX, e.clientY);
    drag.current = {
      kind: "move",
      pointerId: e.pointerId,
      offset: { x: at.x - box.x, y: at.y - box.y },
      moved: false,
    };
  }

  function onHandleDown(side: "left" | "right", e: React.PointerEvent) {
    capture(e);
    drag.current = { kind: side, pointerId: e.pointerId };
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const at = clientToNormalised(e.clientX, e.clientY);
    const cur = latest.current;
    if (d.kind === "move") {
      const to = clampBoxPosition(
        { x: at.x - d.offset.x, y: at.y - d.offset.y },
        pageSize,
        cur,
      );
      if (!d.moved && Math.hypot(to.x - box.x, to.y - box.y) < TAP) return;
      d.moved = true;
      show({ ...cur, ...to });
      return;
    }
    // A side handle: the other side stays put.
    const { min, max } = boxWidthLimits(pageSize, cur);
    const width = boxWidthFraction(pageSize, cur);
    const right = cur.x + width;
    if (d.kind === "right") {
      const w = Math.min(Math.max(at.x - cur.x, min), Math.min(max, 1 - cur.x));
      show({ ...cur, width: w });
    } else {
      const x = Math.min(Math.max(at.x, 0, right - max), right - min);
      show({ ...cur, x, width: right - x });
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    if (d.kind === "move" && !d.moved) {
      // A tap: select it (or let go of it).
      setSelected((s) => !s);
      return;
    }
    if (e.type === "pointercancel") return setPreview(null);
    commit(
      latest.current,
      d.kind === "move" ? "Move notes box" : "Resize notes box",
    );
  }

  function setSize(textSize: BoxTextSize) {
    const to: BoxChange = {
      ...latest.current,
      textSize: textSize === "M" ? undefined : textSize,
    };
    // Kept on the page at its new size.
    Object.assign(to, clampBoxPosition(to, pageSize, to));
    show(to);
    commit(to, `Notes box text ${textSize}`);
  }

  // Sizes on screen are in page units: the bar and handles keep a steady
  // size as the page zooms by being scaled from the text size.
  const ui = m.fontSize;
  // The size bar sits above the box, or below it near the top of the sheet
  // (the page would cut it off).
  const barBelow = shown.y * pageSize.height < ui * 3.6;
  return (
    <div
      ref={host}
      className={`observation-box${selected ? " observation-box-selected" : ""}`}
      data-testid="observation-box"
      data-x={shown.x.toFixed(4)}
      data-y={shown.y.toFixed(4)}
      data-width={(m.width / pageSize.width).toFixed(4)}
      data-text-size={shown.textSize ?? "M"}
      role="group"
      aria-label="Notes box (tap to resize, drag to move)"
      style={{
        left: shown.x * pageSize.width,
        top: shown.y * pageSize.height,
        width: m.width,
        padding: m.padding,
        fontSize: m.fontSize,
        lineHeight: `${m.lineHeight}px`,
        borderWidth: m.borderWidth,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {lines.map((line, i) => (
        <div
          key={i}
          className={`observation-box-${line.style} observation-box-${line.tone}`}
        >
          {line.text}
        </div>
      ))}
      {selected && (
        <>
          {(["left", "right"] as const).map((side) => (
            <span
              key={side}
              className={`observation-box-handle observation-box-handle-${side}`}
              data-testid={`box-handle-${side}`}
              aria-label={`Notes box width (${side})`}
              style={{
                width: ui * 0.9,
                height: ui * 2.4,
                borderWidth: ui * 0.12,
              }}
              onPointerDown={(e) => onHandleDown(side, e)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
          ))}
          <div
            className="observation-box-sizes"
            role="toolbar"
            aria-label="Notes box text size"
            style={{
              fontSize: ui * 0.9,
              ...(barBelow
                ? { top: "100%", marginTop: ui * 0.6 }
                : { top: -ui * 3.2 }),
              padding: ui * 0.3,
              gap: ui * 0.25,
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {SIZES.map((size) => (
              <button
                key={size}
                type="button"
                aria-pressed={(shown.textSize ?? "M") === size}
                aria-label={`Text size ${size}`}
                style={{ padding: `${ui * 0.25}px ${ui * 0.7}px` }}
                onClick={() => setSize(size)}
              >
                {size}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
