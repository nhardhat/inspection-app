import { ChevronDown, Copy, Trash2 } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { useViewerCoords } from "../drawings/viewer/viewerCoords";
import {
  boxCentre,
  isBoxShape,
  isHighlight,
  rotatePoint,
  toPagePoints,
} from "./markGeometry";
import { PRESET_COLOURS, useMarkupPrefs } from "./markupPrefs";
import {
  ROTATE_OFFSET_PX,
  rotateHandle,
  selectionBounds,
  shapeHandles,
  weightIndex,
} from "./selectGeometry";
import type { DocMark } from "./tools";

interface Props {
  /** The selected marks as shown (moved or resized while dragging). */
  marks: DocMark[];
  /** Being dragged: the bar hides. */
  dragging: boolean;
  /** Recolour: highlights take only highlighter colours (and the rest pen ones). */
  onColour: (colour: string, palette: "pen" | "highlighter") => void;
  /** One of the three presets (thin, medium, thick; S, M, L for callouts). */
  onWeight: (index: number) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

/** Screen px between the marks and the dashed box round them, and the bar. */
const GAP_PX = 6;
const BAR_GAP_PX = 10;
/** Roughly the bar's height (screen px), to decide whether it fits above. */
const BAR_PX = 48;
const HANDLE_PX = 6;

/**
 * The Select tool's picked marks (SPEC section 5a, slice 2d): a dashed box
 * round them, a single shape's resize handles, and a floating bar above
 * (below if there's no room) to recolour, change weight, duplicate or
 * delete. Drawn in page units like the marks; the bar is scaled to stay
 * screen-sized. The viewer does the hit-testing for the box and handles.
 */
export function SelectionOverlay({
  marks,
  dragging,
  onColour,
  onWeight,
  onDuplicate,
  onDelete,
}: Props) {
  const { pageSize, clientToNormalised } = useViewerCoords();
  const { width, height } = pageSize;
  const prefs = useMarkupPrefs();
  const [colours, setColours] = useState(false);
  // Screen px the bar is slid sideways to stay on screen (a phone, or a
  // selection near the edge); measured after each layout.
  const barRef = useRef<HTMLDivElement>(null);
  const [nudge, setNudge] = useState(0);
  // Every layout (zoom and scroll move the bar); it settles once it fits.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const r = bar.getBoundingClientRect();
    const left = r.left - nudge;
    const right = r.right - nudge;
    const margin = 8;
    let want = 0;
    if (right > window.innerWidth - margin)
      want = window.innerWidth - margin - right;
    if (left + want < margin) want = margin - left;
    if (Math.abs(want - nudge) > 0.5) setNudge(want);
  });
  if (marks.length === 0) return null;

  // Page units per screen px at the current zoom.
  const origin = clientToNormalised(0, 0);
  const across = clientToNormalised(100, 0);
  const k = Math.max(
    1e-6,
    (Math.hypot(
      (across.x - origin.x) * width,
      (across.y - origin.y) * height,
    ) || 1) / 100,
  );
  const b = selectionBounds(marks, pageSize);
  const gap = GAP_PX * k;
  const handles = marks.length === 1 ? shapeHandles(marks[0], pageSize) : [];
  const turn = rotateHandle(marks, pageSize, ROTATE_OFFSET_PX * k);
  // A single turned box: its dashed outline turns with it.
  const one = marks.length === 1 ? marks[0] : null;
  const turned =
    one && one.rotation && isBoxShape(one.tool)
      ? (() => {
          const [a, c2] = toPagePoints(one.points, pageSize);
          const c = boxCentre([a, c2]);
          const l = Math.min(a.x, c2.x) - gap;
          const r = Math.max(a.x, c2.x) + gap;
          const t = Math.min(a.y, c2.y) - gap;
          const bt = Math.max(a.y, c2.y) + gap;
          return {
            corners: [
              { x: l, y: t },
              { x: r, y: t },
              { x: r, y: bt },
              { x: l, y: bt },
            ].map((p) => rotatePoint(p, c, one.rotation!)),
            top: rotatePoint({ x: (l + r) / 2, y: t }, c, one.rotation),
          };
        })()
      : null;

  const highlights = marks.filter(isHighlight);
  const palette = highlights.length === marks.length ? "highlighter" : "pen";
  const shown =
    marks.find((m) => (palette === "pen") === !isHighlight(m)) ?? marks[0];
  // Callouts keep their size unless only callouts are picked (S, M, L).
  const onlyText = marks.every((m) => m.tool === "text");
  const sized = onlyText ? marks : marks.filter((m) => m.tool !== "text");
  const indexes = new Set(sized.map(weightIndex));
  const weightOn = indexes.size === 1 ? [...indexes][0] : -1;
  const names = onlyText
    ? ["Small", "Medium", "Large"]
    : ["Thin", "Medium", "Thick"];
  // Above the rotate handle when there is one.
  const barGap = turn ? ROTATE_OFFSET_PX + 18 : BAR_GAP_PX;
  const above = b.y - gap - (barGap + BAR_PX) * k > 0;
  const slots = [
    ...new Set([...prefs.palettes[palette], ...PRESET_COLOURS[palette]]),
  ];

  return (
    <>
      <svg
        className="selection-overlay"
        data-testid="selection"
        data-count={marks.length}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden="true"
      >
        {turned ? (
          <polygon
            points={turned.corners.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke="#3b3b3b"
            strokeWidth={1.5 * k}
            strokeDasharray={`${6 * k} ${4 * k}`}
          />
        ) : (
          <rect
            x={b.x - gap}
            y={b.y - gap}
            width={b.width + 2 * gap}
            height={b.height + 2 * gap}
            fill="none"
            stroke="#3b3b3b"
            strokeWidth={1.5 * k}
            strokeDasharray={`${6 * k} ${4 * k}`}
          />
        )}
        {turn && (
          <g data-testid="handle-rotate">
            <line
              x1={turned ? turned.top.x : b.x + b.width / 2}
              y1={turned ? turned.top.y : b.y - gap}
              x2={turn.x}
              y2={turn.y}
              stroke="#3b3b3b"
              strokeWidth={1.5 * k}
            />
            <circle
              cx={turn.x}
              cy={turn.y}
              r={HANDLE_PX * 1.4 * k}
              fill="#fff"
              stroke="#3b3b3b"
              strokeWidth={1.5 * k}
            />
            <path
              d={`M ${turn.x - 3 * k} ${turn.y - 2 * k} A ${3.5 * k} ${3.5 * k} 0 1 1 ${turn.x + 3 * k} ${turn.y + 2 * k}`}
              fill="none"
              stroke="#3b3b3b"
              strokeWidth={1.2 * k}
            />
          </g>
        )}
        {handles.map((h) =>
          h.id === "width" ? (
            <rect
              key={h.id}
              data-testid="handle-width"
              x={h.at.x - 5 * k}
              y={h.at.y - 9 * k}
              width={10 * k}
              height={18 * k}
              rx={3 * k}
              fill="#fff"
              stroke="#3b3b3b"
              strokeWidth={1.5 * k}
            />
          ) : h.id === "start" || h.id === "end" || h.id === "tip" ? (
            <circle
              key={h.id}
              data-testid={`handle-${h.id}`}
              cx={h.at.x}
              cy={h.at.y}
              r={HANDLE_PX * 1.2 * k}
              fill="#fff"
              stroke="#3b3b3b"
              strokeWidth={1.5 * k}
            />
          ) : (
            <rect
              key={h.id}
              data-testid={`handle-${h.id}`}
              x={h.at.x - HANDLE_PX * k}
              y={h.at.y - HANDLE_PX * k}
              width={2 * HANDLE_PX * k}
              height={2 * HANDLE_PX * k}
              fill="#fff"
              stroke="#3b3b3b"
              strokeWidth={1.5 * k}
            />
          ),
        )}
      </svg>
      {!dragging && (
        <div
          ref={barRef}
          className="select-bar"
          role="toolbar"
          aria-label="Selection"
          // Its own taps: never the drawing's.
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          style={{
            left: b.x - gap,
            top: above
              ? b.y - gap - barGap * k
              : b.y + b.height + gap + BAR_GAP_PX * k,
            transform: `translateX(${nudge * k}px) scale(${k})${above ? " translateY(-100%)" : ""}`,
          }}
        >
          <button
            type="button"
            className="select-colour"
            aria-label="Colour"
            aria-expanded={colours}
            onClick={() => setColours((o) => !o)}
          >
            <span
              className="markup-swatch"
              style={{ backgroundColor: shown.colour }}
              aria-hidden="true"
            />
            <ChevronDown aria-hidden="true" strokeWidth={2.5} />
          </button>
          <span className="select-divider" aria-hidden="true" />
          {names.map((name, i) => (
            <button
              key={name}
              type="button"
              className="select-weight"
              aria-label={name}
              aria-pressed={weightOn === i}
              onClick={() => onWeight(i)}
            >
              {onlyText ? (
                <span style={{ fontSize: 12 + 2 * i }}>{"SML"[i]}</span>
              ) : (
                <span
                  className="select-weight-line"
                  style={{ height: [2, 4, 7][i] }}
                />
              )}
            </button>
          ))}
          <span className="select-divider" aria-hidden="true" />
          <button
            type="button"
            className="select-action"
            aria-label="Duplicate"
            onClick={onDuplicate}
          >
            <Copy aria-hidden="true" />
            <span className="select-action-label">Duplicate</span>
          </button>
          <button
            type="button"
            className="select-action select-delete"
            aria-label="Delete"
            onClick={onDelete}
          >
            <Trash2 aria-hidden="true" />
            <span className="select-action-label">Delete</span>
          </button>
          {colours && (
            <div
              className="select-colours"
              role="group"
              aria-label="Selection colour"
            >
              {slots.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="markup-swatch"
                  style={{ backgroundColor: c }}
                  aria-label={`Use ${c}`}
                  aria-pressed={c.toUpperCase() === shown.colour.toUpperCase()}
                  onClick={() => {
                    setColours(false);
                    onColour(c, palette);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
