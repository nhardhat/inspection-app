import { useLiveQuery } from "dexie-react-hooks";
import { Files, List, Maximize, Redo2, Undo2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { readPlace, writePlace } from "../../app/sessionPlace";
import { NotFound } from "../../app/NotFound";
import {
  peekUndo,
  pushUndo,
  redoLast,
  undoLast,
  useUndo,
} from "../../app/undo";
import { db } from "../../db/db";
import { listDrawings, setPageSizes } from "../../db/drawings";
import { listMarkups, type MarkupPatch } from "../../db/markups";
import {
  HIGHLIGHTER_OPACITY,
  WEIGHT_PRESETS,
  toStoredPoints,
  isHighlight,
} from "../markup/markGeometry";
import {
  clampMove,
  type HandleId,
  movedPoints,
  rotatedMark,
  rotationBy,
  rotationCentre,
  resizedPoints,
  selectionBounds,
  weightToolOf,
} from "../markup/selectGeometry";
import { SelectionOverlay } from "../markup/SelectionOverlay";
import {
  changeMarkWithUndo,
  drawWithUndo,
  eraseWithUndo,
  unfillWithUndo,
  changeMarksWithUndo,
  duplicateWithUndo,
} from "../markup/markupActions";
import { toolColour, useMarkupPrefs } from "../markup/markupPrefs";
import { MarkupOverlay } from "../markup/MarkupOverlay";
import { CalloutsOverlay, type CalloutDraft } from "../markup/CalloutsOverlay";
import {
  calloutMetrics,
  calloutHang,
  calloutPoints,
  calloutSize,
  hungBoxOrigin,
} from "../markup/calloutGeometry";
import { measureArial } from "../markup/measureText";
import { MarkupToolbar } from "../markup/MarkupToolbar";
import type { DocMark, ViewerTool } from "../markup/tools";
import type { HeldShape, MarkupShape, MarkupTool } from "../../db/types";
import { placeObservationBox, updateCopy, updateItem } from "../../db/items";
import {
  createGeneralNoteWithUndo,
  createItemWithUndo,
  setArrowsWithUndo,
  addCopyWithUndo,
  removeSpotWithUndo,
  setKindWithUndo,
  switchNewItemKind,
} from "../items/itemActions";
import { InspectionHeader } from "../inspections/InspectionTabs";
import { QuickPhotoButton } from "../photos/QuickPhotoButton";
import { DrawingsSection } from "./DrawingsSection";
import { PagesSheet } from "./PagesSheet";
import { kindName } from "../items/letters";
import { ArrowsOverlay } from "./ArrowsOverlay";
import {
  isOnPage,
  itemSpots,
  parseSpotKey,
  type PinSpot,
} from "../items/spots";
import type { Drawing, Item, ItemArrow, ItemKind } from "../../db/types";
import { ItemSheet } from "../items/ItemSheet";
import { ItemsPanel } from "../items/ItemsPanel";
import {
  DocumentViewer,
  type DocPin,
  type MarkSelection,
  type ScrollTarget,
  type SelectDrag,
} from "./document/DocumentViewer";
import {
  layoutDocument,
  pageKey,
  type PageLayout,
} from "./document/documentLayout";
import { usePdfDocuments } from "./document/usePdfDocuments";
import { DOUBLE_TAP_MS } from "./document/gestures";
import { ObservationBoxOverlay } from "./ObservationBoxOverlay";
import { ExportedLettersNotice } from "../export/ExportedLettersNotice";
import {
  DEFAULT_OBSERVATION_HEADING,
  boxHeader,
  boxLines,
  defaultBoxPosition,
  observationHeading,
} from "./observationBox";
import type { Point, Size } from "./viewer/viewTransform";

/** Measures and saves page sizes for drawings added before they were stored. */
async function backfillPageSizes(drawing: Drawing) {
  const stored = await db.blobs.get(drawing.pdfBlobId);
  if (!stored) return;
  const { loadPdf } = await import("./pdf/pdfjs");
  const { measurePageSizes } = await import("./pdf/pageSizes");
  const pdf = await loadPdf(new Uint8Array(stored.data.slice(0)));
  try {
    await setPageSizes(db, drawing.id, await measurePageSizes(pdf));
  } finally {
    await pdf.loadingTask.destroy();
  }
}

const NO_MARKS: DocMark[] = [];

/** Now, in performance.now() time (event handlers only). */
function nowMs() {
  return performance.now();
}

/** A tap this soon after a callout finished only closed it. */
const CLOSE_TAP_MS = 600;

/** Milliseconds until a performance.now() time (event handlers only). */
function msUntil(time: number) {
  return time - performance.now();
}

/**
 * A selected shape's points with handle `handle` dragged to `to`; a
 * callout's width is measured like the Text tool's side handle.
 */
/**
 * What a drag of the selection does to each picked mark: a move, a turn
 * about the selection's middle (rotate handle), or (one mark) a resize.
 */
function draggedPatches(
  marks: Pick<
    DocMark,
    "id" | "tool" | "points" | "weight" | "text" | "rotation" | "fill"
  >[],
  drag: SelectDrag,
  size: Size,
): Map<string, MarkupPatch> {
  const out = new Map<string, MarkupPatch>();
  if (drag.kind === "move") {
    for (const m of marks)
      out.set(m.id, { points: movedPoints(m, drag.dx, drag.dy) });
    return out;
  }
  if (drag.handle === "rotate") {
    const units = (p: Point) => ({
      x: p.x * size.width,
      y: p.y * size.height,
    });
    const c = rotationCentre(marks, size);
    const angle = rotationBy(marks, c, units(drag.from), units(drag.to));
    for (const m of marks) out.set(m.id, rotatedMark(m, size, c, angle));
    return out;
  }
  if (marks.length !== 1) return out;
  const m = marks[0];
  out.set(m.id, {
    points: handlePoints(m, drag.handle, drag.to, size),
    // A callout resized by hand keeps its width.
    ...(m.tool === "text" && drag.handle === "width"
      ? { fixedWidth: true }
      : {}),
  });
  return out;
}

function handlePoints(
  mark: Pick<DocMark, "tool" | "points" | "weight" | "text" | "rotation">,
  handle: HandleId,
  to: Point,
  size: Size,
): number[] {
  if (mark.tool !== "text" || handle !== "width")
    return resizedPoints(mark, handle, to, size);
  const [x, y, , , ...tip] = mark.points;
  const box = calloutSize(
    mark.text ?? "",
    calloutMetrics(mark.weight, size),
    measureArial,
    // Never past the page's right edge.
    Math.min(to.x, 1) * size.width - x * size.width,
  );
  const round = (n: number) => Math.round(n * 1e5) / 1e5;
  return [
    x,
    y,
    round(box.width / size.width),
    round(box.height / size.height),
    ...tip,
  ];
}

export function DocumentScreen() {
  const { id = "" } = useParams();
  return <InspectionDocument key={id} inspectionId={id} />;
}

/**
 * All of an inspection's drawings as one scrolling document, with pins, the
 * item sheet and each page's notes box. URL: ?drawing=<id> opens at that
 * drawing, ?item=<id> selects an item and scrolls to its pin.
 */
function InspectionDocument({ inspectionId }: { inspectionId: string }) {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("item");
  const startDrawing = params.get("drawing");

  const inspection = useLiveQuery(
    () => db.inspections.get(inspectionId),
    [inspectionId],
  );
  const drawings = useLiveQuery(
    () => listDrawings(db, inspectionId),
    [inspectionId],
  );
  const items = useLiveQuery(
    () => db.items.where("inspectionId").equals(inspectionId).toArray(),
    [inspectionId],
  );
  const boxes = useLiveQuery(async () => {
    const ids = (await db.drawings
      .where("inspectionId")
      .equals(inspectionId)
      .primaryKeys()) as string[];
    return db.observationBoxes
      .filter((b) => ids.includes(b.drawingId))
      .toArray();
  }, [inspectionId]);
  const marks = useLiveQuery(
    () => listMarkups(db, inspectionId),
    [inspectionId],
  );
  const heading = useLiveQuery(async () => {
    const headings = await db.snippets
      .where("kind")
      .equals("heading")
      .toArray();
    return observationHeading(headings);
  }, []);

  const history = useUndo(inspectionId);
  // The markup toolbar's tool: none when the drawings open (SPEC 5a).
  const [tool, setTool] = useState<ViewerTool | null>(null);
  // The callout tapped with Text on: a second tap edits it (SPEC 5a).
  const [selectedCallout, setSelectedCallout] = useState<string | null>(null);
  // The tool on before a tapped callout turned Text on, to go back to.
  const toolBeforeText = useRef<ViewerTool | null>(null);
  // The tool on before a tapped mark turned Select on, to go back to.
  const toolBeforeSelect = useRef<{ tool: ViewerTool | null } | null>(null);
  function changeTool(next: ViewerTool | null) {
    toolBeforeText.current = null;
    toolBeforeSelect.current = null;
    setTool(next);
    setSelectedCallout(null);
    setSelection(null);
  }
  // The Select tool's picked marks, and a drag of them under way (slice 2d).
  const [selection, setSelection] = useState<MarkSelection | null>(null);
  const [selectDrag, setSelectDrag] = useState<SelectDrag | null>(null);
  /**
   * A tap on open space after making or selecting a callout lets go of it
   * altogether (engineer, 2026-10-06): Text turns off, back to the tool on
   * before a tapped callout turned it on (else none).
   */
  function releaseText() {
    const back = toolBeforeText.current;
    toolBeforeText.current = null;
    setSelectedCallout(null);
    setTool(back);
  }
  const prefs = useMarkupPrefs();
  // Marks the eraser is passing over: hidden until it lifts.
  const [erasing, setErasing] = useState<Set<string>>(() => new Set());
  const [itemsOpen, setItemsOpen] = useState(false);
  // Opened with ?pages=1 from the Drawings card on Pre-inspection.
  const [pagesOpen, setPagesOpen] = useState(() => params.get("pages") === "1");
  // While drawings are being added (or one failed), the list stays in view
  // so its progress and errors can be read.
  const [adding, setAdding] = useState({ busy: false, failed: false });
  const [fitRequest, setFitRequest] = useState(0);
  const [justPlaced, setJustPlaced] = useState<string | null>(null);
  const [dragging, setDragging] = useState<Record<string, Point>>({});
  const [current, setCurrent] = useState<PageLayout | null>(null);
  const [needed, setNeeded] = useState<string[]>([]);
  const [pinsInView, setPinsInView] = useState<Set<string>>(() => new Set());
  const [scrollTarget, setScrollTarget] = useState<ScrollTarget | null>(null);
  const [backfillError, setBackfillError] = useState<string | null>(null);
  // Arrows: the item waiting for a tap, the selected tip, a tip being dragged.
  const [placingArrow, setPlacingArrow] = useState<string | null>(null);
  const [arrowMessage, setArrowMessage] = useState<string | null>(null);
  const [selectedArrow, setSelectedArrow] = useState<string | null>(null);
  const [draggingArrow, setDraggingArrow] = useState<{
    /** The pin's spot key (an item id, or "itemId~copyId" for a copy). */
    key: string;
    arrowId: string;
    to: Point;
  } | null>(null);
  // Copy pin: the item whose copies each tap on the drawing places.
  const [copying, setCopying] = useState<string | null>(null);

  // Drawings added before page sizes were stored get them measured once.
  const missingSizes =
    drawings
      ?.filter((d) => !d.pageSizes)
      .map((d) => d.id)
      .join(",") ?? "";
  useEffect(() => {
    if (!missingSizes || !drawings) return;
    let current = true;
    void (async () => {
      for (const drawing of drawings.filter((d) => !d.pageSizes)) {
        if (!current) return;
        try {
          await backfillPageSizes(drawing);
        } catch (e) {
          setBackfillError(
            `${drawing.name}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    })();
    return () => {
      current = false;
    };
    // Re-run only when the set of drawings without sizes changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingSizes]);

  const layout = useMemo(
    () =>
      layoutDocument(
        (drawings ?? [])
          .filter((d) => d.pageSizes)
          .map((d) => ({
            id: d.id,
            name: d.name,
            pageSizes: d.pageSizes!,
            pages: d.pages,
          })),
      ),
    [drawings],
  );

  const blobIds = useMemo(
    () => new Map((drawings ?? []).map((d) => [d.id, d.pdfBlobId])),
    [drawings],
  );
  const { docs, errors } = usePdfDocuments(needed, blobIds);

  const selected = items?.find((item) => item.id === selectedId) ?? null;

  // The page this inspection's drawings were last open at (this session),
  // read once before the viewer reports its first page.
  const [savedPage] = useState(() => readPlace(`doc-page:${inspectionId}`));

  // Initial scroll: to the selected item, else the requested drawing, else
  // where the drawings were left.
  const initialScrollDone = useRef(false);
  useEffect(() => {
    if (initialScrollDone.current || layout.pages.length === 0 || !items)
      return;
    initialScrollDone.current = true;
    // One-off, once the drawings and items have loaded (not a render loop).
    if (selected) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setScrollTarget({
        pageKey: pageKey(selected.drawingId, selected.page),
        at: { x: selected.x, y: selected.y },
        token: Date.now(),
      });
    } else if (startDrawing) {
      // Its first visible page (page 1 may be hidden).
      const first = layout.pages.find((p) => p.drawingId === startDrawing);
      if (first) setScrollTarget({ pageKey: first.key, token: Date.now() });
    } else if (savedPage && layout.pages.some((p) => p.key === savedPage)) {
      setScrollTarget({ pageKey: savedPage, token: Date.now() });
    }
  }, [layout, items, selected, startDrawing, savedPage]);

  /** A pin as shown right now: the pin or an arrow tip mid-drag included. */
  function live(spot: PinSpot): PinSpot {
    const arrows = spot.arrows.map((arrow) =>
      draggingArrow?.key === spot.key && draggingArrow.arrowId === arrow.id
        ? { ...arrow, ...draggingArrow.to }
        : arrow,
    );
    return { ...spot, ...(dragging[spot.key] ?? {}), arrows };
  }

  // One pin per spot: an item's original and its copies share its letter.
  const pins: DocPin[] = (items ?? []).flatMap((item) =>
    itemSpots(item).map((spot) => {
      const shown = live(spot);
      return {
        id: spot.key,
        letter: item.letter,
        kind: item.kind,
        selected: item.id === selectedId,
        pageKey: pageKey(spot.drawingId, spot.page),
        x: shown.x,
        y: shown.y,
        arrows: shown.arrows,
        selectedArrowId: item.id === selectedId ? selectedArrow : null,
      };
    }),
  );

  // General notes (no pin): listed in every page's notes box.
  const generalNotes = useMemo(
    () => (items ?? []).filter((item) => item.general),
    [items],
  );

  const docMarks: DocMark[] = useMemo(
    () =>
      (marks ?? [])
        .filter((m) => !erasing.has(m.id))
        .map((m) => ({
          id: m.id,
          pageKey: pageKey(m.drawingId, m.page),
          tool: m.tool,
          points: m.points,
          colour: m.colour,
          weight: m.weight,
          fill: m.fill,
          highlight: m.highlight,
          rotation: m.rotation,
          text: m.text,
          fixedWidth: m.fixedWidth,
        })),
    [marks, erasing],
  );
  // Each page's marks as one list that only changes with them.
  // Each page's text callouts, as a list that only changes with them.
  const calloutsByPage = useMemo(() => {
    const byPage = new Map<string, DocMark[]>();
    for (const mark of docMarks)
      if (mark.tool === "text")
        byPage.set(mark.pageKey, [...(byPage.get(mark.pageKey) ?? []), mark]);
    return byPage;
  }, [docMarks]);
  // A callout being typed (new, or an existing one tapped with Text on).
  const [draft, setDraft] = useState<
    (CalloutDraft & { pageKey: string }) | null
  >(null);
  // Read and cleared at once, so a callout is saved once even when the box
  // losing focus and a new tap both finish it.
  const draftRef = useRef(draft);
  function putDraft(next: typeof draft) {
    draftRef.current = next;
    setDraft(next);
  }
  /** When a callout being typed last finished (the box lost focus). */
  const draftClosed = useRef(-Infinity);

  /** Saves the callout being typed: empty, it goes (or isn't made). */
  async function commitDraft() {
    const d = draftRef.current;
    if (!d) return;
    putDraft(null);
    draftClosed.current = nowMs();
    const page = layout.pages.find((p) => p.key === d.pageKey);
    const existing = d.id ? marks?.find((m) => m.id === d.id) : undefined;
    if (!page) return;
    const text = d.text.trim().toUpperCase();
    if (!text) {
      if (existing) await eraseWithUndo(inspectionId, [existing]);
      return;
    }
    const size = page.size;
    const box = calloutSize(
      text,
      calloutMetrics(d.size, size),
      measureArial,
      d.width === null ? undefined : d.width * size.width,
    );
    const points = calloutPoints(
      {
        box: {
          ...hungBoxOrigin(
            { x: d.box.x * size.width, y: d.box.y * size.height },
            box,
            d.hang,
          ),
          ...box,
        },
        tip: d.tip && { x: d.tip.x * size.width, y: d.tip.y * size.height },
      },
      size,
    );
    if (existing) {
      if (existing.text !== text)
        await changeMarkWithUndo(existing, { text, points }, "Edit text");
      return;
    }
    await drawWithUndo({
      inspectionId,
      drawingId: page.drawingId,
      page: page.page,
      tool: "text",
      points,
      text,
      colour: d.colour,
      weight: d.size,
    });
  }

  function placeText(page: PageLayout, box: Point, tip: Point | null) {
    // While one is being typed, a tap elsewhere only finishes it (like
    // tapping off the Items panel). The box usually loses focus as the
    // finger goes down, so a tap just after counts too.
    if (draftRef.current) return void commitDraft();
    if (nowMs() - draftClosed.current < CLOSE_TAP_MS) return;
    setSelectedCallout(null);
    putDraft({
      pageKey: page.key,
      id: null,
      box,
      tip,
      hang: tip ? calloutHang(box, tip) : undefined,
      width: null,
      text: "",
      colour: toolColour(prefs, "text"),
      size: prefs.weight.text,
    });
  }

  /**
   * A tap on a callout, whatever tool is on: the first selects it (turning
   * Text on, so it can be moved, re-pointed and resized); a second edits it.
   */
  function tapCallout(mark: DocMark) {
    if (draftRef.current) return void commitDraft();
    if (tool === "text" && selectedCallout === mark.id)
      return editCallout(mark);
    if (tool !== "text") {
      toolBeforeText.current = tool;
      setTool("text");
    }
    setSelectedCallout(mark.id);
  }

  function editCallout(mark: DocMark) {
    const [x, y, w, , tx, ty] = mark.points;
    putDraft({
      pageKey: mark.pageKey,
      id: mark.id,
      box: { x, y },
      tip: tx === undefined || ty === undefined ? null : { x: tx, y: ty },
      width: mark.fixedWidth ? w : null,
      text: mark.text ?? "",
      colour: mark.colour,
      size: mark.weight,
    });
  }

  function moveCallout(mark: DocMark, points: number[]) {
    const existing = marks?.find((m) => m.id === mark.id);
    if (existing) void changeMarkWithUndo(existing, { points }, "Move text");
  }

  function resizeCallout(mark: DocMark, points: number[]) {
    const existing = marks?.find((m) => m.id === mark.id);
    if (existing)
      void changeMarkWithUndo(
        existing,
        { points, fixedWidth: true },
        "Resize text",
      );
  }

  const marksByPage = useMemo(() => {
    const byPage = new Map<string, DocMark[]>();
    for (const mark of docMarks)
      byPage.set(mark.pageKey, [...(byPage.get(mark.pageKey) ?? []), mark]);
    return byPage;
  }, [docMarks]);

  // The selected marks, and (while dragged) where they're shown: only the
  // selection's page gets new lists, so the other pages don't redraw.
  const selectedMarks = useMemo(
    () =>
      selection
        ? (marksByPage.get(selection.pageKey) ?? []).filter((m) =>
            selection.ids.includes(m.id),
          )
        : [],
    [selection, marksByPage],
  );
  const selectionPage = selection
    ? layout.pages.find((p) => p.key === selection.pageKey)
    : undefined;
  const preview = useMemo(() => {
    if (!selection || !selectDrag) return null;
    const moved = draggedPatches(
      selectedMarks,
      selectDrag,
      selectionPage?.size ?? { width: 1, height: 1 },
    );
    const apply = (list: DocMark[]) =>
      list.map((m) => {
        const patch = moved.get(m.id);
        return patch ? { ...m, ...patch } : m;
      });
    return {
      pageKey: selection.pageKey,
      marks: apply(marksByPage.get(selection.pageKey) ?? []),
      callouts: apply(calloutsByPage.get(selection.pageKey) ?? []),
      selected: apply(selectedMarks),
    };
  }, [
    selection,
    selectDrag,
    selectedMarks,
    marksByPage,
    calloutsByPage,
    selectionPage,
  ]);

  /**
   * A tap or loop with Select on: a callout being typed closes first. When
   * Select came on by tapping a mark, letting go goes back to the tool
   * that was on.
   */
  function selectMarks(next: MarkSelection | null) {
    if (draftRef.current) return void commitDraft();
    setSelection(next);
    const back = toolBeforeSelect.current;
    if (!next && back) {
      toolBeforeSelect.current = null;
      setTool(back.tool);
    }
  }

  /**
   * A tap on a drawn mark with no tool on (engineer, 2026-10-07; drawing
   * tools no longer pick, 2026-10-20): it's picked and Select comes on, so
   * it can be resized, rotated or changed straight away. Something open
   * closes first, as with any tap on the drawing.
   */
  function tapMark(sel: MarkSelection, hit: { page: PageLayout; at: Point }) {
    if (draftRef.current || pendingOpen.current || selectedId || itemsOpen)
      return tapDrawing(hit);
    if (tool !== "select") toolBeforeSelect.current = { tool };
    setTool("select");
    setSelection(sel);
  }

  // What a two-finger double-tap undid, shown briefly over the drawing.
  const [undoNote, setUndoNote] = useState<string | null>(null);
  const undoNoteTimer = useRef(0);
  function undoByGesture() {
    const entry = peekUndo(inspectionId);
    window.clearTimeout(undoNoteTimer.current);
    setUndoNote(entry ? `Undo: ${entry.label}` : "Nothing to undo");
    undoNoteTimer.current = window.setTimeout(() => setUndoNote(null), 1400);
    if (!entry) return;
    // As the Undo button: an undone change could leave the sheet pointing
    // at nothing.
    select(null);
    void undoLast(inspectionId);
  }

  /** The saved records of the selected marks. */
  const selectedRecords = () =>
    (marks ?? []).filter((m) => selection?.ids.includes(m.id));

  /** A drag of the selection (or a shape's handle) moved, or lifted. */
  function dragSelection(drag: SelectDrag | null, done: boolean) {
    if (!done) return setSelectDrag(drag);
    const records = selectedRecords();
    if (!drag || records.length === 0) return setSelectDrag(null);
    const many = records.length === 1 ? "" : ` ${records.length} marks`;
    const label =
      drag.kind === "move"
        ? `Move${many}`
        : drag.handle === "rotate"
          ? `Rotate${many}`
          : "Resize";
    const patches = draggedPatches(
      records,
      drag,
      selectionPage?.size ?? { width: 1, height: 1 },
    );
    // The dragged spot stays shown until the saved one arrives.
    void changeMarksWithUndo(
      records,
      (m) => patches.get(m.id) ?? {},
      label,
    ).finally(() => setSelectDrag(null));
  }

  /** Recolour: highlights only from the highlighter's colours, the rest from the pen's. */
  function recolourSelection(colour: string, palette: "pen" | "highlighter") {
    const records = selectedRecords().filter(
      (m) => isHighlight(m) === (palette === "highlighter"),
    );
    void changeMarksWithUndo(records, () => ({ colour }), "Change colour");
  }

  /** A weight preset; callouts keep their size unless they're all that's picked. */
  function reweightSelection(index: number) {
    const all = selectedRecords();
    const onlyText = all.every((m) => m.tool === "text");
    const records = onlyText ? all : all.filter((m) => m.tool !== "text");
    void changeMarksWithUndo(
      records,
      (m) => {
        const weight = WEIGHT_PRESETS[weightToolOf(m)][index];
        // A callout's box follows its new text size.
        if (m.tool !== "text") return { weight };
        const page = layout.pages.find(
          (p) => p.drawingId === m.drawingId && p.page === m.page,
        );
        if (!page) return { weight };
        const size = page.size;
        const [x, y, w, , ...tip] = m.points;
        const box = calloutSize(
          m.text ?? "",
          calloutMetrics(weight, size),
          measureArial,
          m.fixedWidth ? w * size.width : undefined,
        );
        return {
          weight,
          points: [
            x,
            y,
            Math.round((box.width / size.width) * 1e5) / 1e5,
            Math.round((box.height / size.height) * 1e5) / 1e5,
            ...tip,
          ],
        };
      },
      "Change weight",
    );
  }

  /** Copies a little down and right; the copies become the selection. */
  async function duplicateSelection() {
    const records = selectedRecords();
    if (!selectionPage || records.length === 0) return;
    const size = selectionPage.size;
    const offset = 0.02 * Math.min(size.width, size.height);
    const { dx, dy } = clampMove(
      selectionBounds(selectedMarks, size),
      size,
      offset / size.width,
      offset / size.height,
    );
    const copies = await duplicateWithUndo(records, (m) =>
      movedPoints(m, dx, dy),
    );
    setSelection({
      pageKey: selectionPage.key,
      ids: copies.map((c) => c.id),
    });
  }

  function deleteSelection() {
    const records = selectedRecords();
    setSelection(null);
    void eraseWithUndo(
      inspectionId,
      records,
      records.length === 1 ? "Delete" : `Delete ${records.length} marks`,
    );
  }
  const inkTool: MarkupTool =
    tool === "highlighter" || tool === "shapes" ? tool : "pen";

  /** A finished stroke or shape (a pen stroke straightened: a line). */
  async function saveStroke(
    page: PageLayout,
    points: Point[],
    shape: MarkupShape | HeldShape | null,
    rotation?: number,
  ) {
    if (tool !== "pen" && tool !== "highlighter" && tool !== "shapes") return;
    await drawWithUndo({
      inspectionId,
      drawingId: page.drawingId,
      page: page.page,
      tool: shape ?? (tool === "shapes" ? prefs.shape : tool),
      // Already normalised: stored rounded.
      points: toStoredPoints(points, { width: 1, height: 1 }),
      // The pen's (or highlighter's) colour and weight for its held shapes.
      colour: toolColour(prefs, tool),
      weight: prefs.weight[tool],
      // A shape held with the highlighter is drawn like a highlight.
      ...(shape && tool === "highlighter" ? { highlight: true } : {}),
      ...(rotation ? { rotation } : {}),
    });
  }

  function unfill(id: string) {
    const mark = marks?.find((m) => m.id === id);
    if (mark) void unfillWithUndo(mark);
  }

  function erase(ids: string[], done: boolean) {
    if (!done) return setErasing(new Set(ids));
    const gone = (marks ?? []).filter((m) => ids.includes(m.id));
    void eraseWithUndo(inspectionId, gone).finally(() => setErasing(new Set()));
  }

  const itemOf = (key: string) =>
    items?.find((i) => i.id === parseSpotKey(key).itemId);

  /** "Page 4": a page's number through the document. */
  const pageLabel = (drawingId: string, page: number) =>
    `Page ${layout.pages.find((p) => p.drawingId === drawingId && p.page === page)?.number ?? "?"}`;

  function select(itemId: string | null) {
    const next: Record<string, string> = {};
    if (itemId) next.item = itemId;
    setParams(next, { replace: true });
    if (itemId !== selectedId) {
      setSelectedArrow(null);
      setPlacingArrow(null);
      setArrowMessage(null);
      setCopying(null);
    }
  }

  async function placeArrow(page: PageLayout, at: Point) {
    const item = items?.find((i) => i.id === placingArrow);
    if (!item) return setPlacingArrow(null);
    // Arrows stay on a pin's page: the item's pin on the tapped page (the
    // nearest, if it has copies there) gets it.
    const spots = itemSpots(item);
    const onPage = spots.filter(
      (s) => s.drawingId === page.drawingId && s.page === page.page,
    );
    if (onPage.length === 0) {
      const pages = [
        ...new Set(spots.map((s) => pageLabel(s.drawingId, s.page))),
      ];
      setArrowMessage(
        `Tap on ${pages.join(" or ").toLowerCase()}, where the pin is.`,
      );
      return;
    }
    const spot = onPage.reduce((best, s) =>
      Math.hypot(s.x - at.x, s.y - at.y) <
      Math.hypot(best.x - at.x, best.y - at.y)
        ? s
        : best,
    );
    const arrow = { id: crypto.randomUUID(), ...at };
    setPlacingArrow(null);
    setArrowMessage(null);
    await setArrowsWithUndo(
      item,
      [...spot.arrows, arrow],
      `Add arrow to ${kindName(item.kind).toLowerCase()} ${item.letter}`,
      spot.copyId,
    );
    setSelectedArrow(arrow.id);
  }

  /** Copy pin: each tap pins the item again (it stays on until Done). */
  async function placeCopy(page: PageLayout, at: Point) {
    const item = items?.find((i) => i.id === copying);
    if (!item) return setCopying(null);
    await addCopyWithUndo(
      item,
      { drawingId: page.drawingId, page: page.page, ...at },
      defaultBoxPosition(page.size),
    );
  }

  async function placePin(
    page: PageLayout,
    at: Point,
    options: { arrows?: ItemArrow[]; kind?: ItemKind; openAt?: number } = {},
  ) {
    cancelPendingOpen();
    const token = openToken.current;
    const item = await createItemWithUndo(
      {
        inspectionId,
        drawingId: page.drawingId,
        page: page.page,
        ...at,
        arrows: options.arrows,
        kind: options.kind,
      },
      defaultBoxPosition(page.size),
    );
    const open = () => {
      pendingOpen.current = 0;
      // Cancelled meanwhile (a double-tap's second press, or another pin).
      if (openToken.current !== token) return;
      // Its double-tap window is over: a later double-tap on it switches
      // its kind (its own Undo step) rather than finishing this tap.
      placedByTap.current = null;
      setJustPlaced(item.id);
      select(item.id);
    };
    // A tapped pin opens once a double-tap is no longer possible: the
    // editor could cover the spot of the second tap, and a double-tap and
    // hold opens it only when the finger lifts.
    const wait = msUntil(options.openAt ?? 0);
    if (wait > 0) pendingOpen.current = window.setTimeout(open, wait);
    else open();
    return item;
  }

  /** The pin the latest tap placed (it may still be saving), and when. */
  const placedByTap = useRef<{ item: Promise<Item>; time: number } | null>(
    null,
  );
  /** A tapped pin waiting to open (see placePin). */
  const pendingOpen = useRef(0);
  /** Changes when a pending open is cancelled (even before it is timed). */
  const openToken = useRef(0);

  function cancelPendingOpen() {
    window.clearTimeout(pendingOpen.current);
    pendingOpen.current = 0;
    openToken.current++;
  }
  /**
   * The pin a double-tap's second press turned into an observation (or
   * null: it pressed something else), resolved once saved.
   */
  const secondPressed = useRef<Promise<Item | null> | null>(null);

  function openItem(id: string) {
    setJustPlaced(id);
    select(id);
  }

  /**
   * The second press of a double-tap went down. When the first tap placed
   * a pin, it turns into an observation now (same Undo step); its editor
   * waits until the finger lifts, which may be after a hold and an arrow.
   */
  function secondPress(
    target: { pinId: string } | { hit: { page: PageLayout; at: Point } | null },
  ) {
    cancelPendingOpen();
    const placing = placedByTap.current;
    placedByTap.current = null;
    const pinId = "pinId" in target ? target.pinId : null;
    secondPressed.current = (async () => {
      // Only a pin placed by the first tap of this double-tap counts.
      const created =
        placing && performance.now() - placing.time < 1000
          ? await placing.item
          : null;
      if (
        !created ||
        (pinId !== null && parseSpotKey(pinId).itemId !== created.id)
      )
        return null;
      await switchNewItemKind(created, "observation");
      return created;
    })();
  }

  /** What the second press turned (and forgets it). */
  async function takeSecondPressed() {
    const pending = secondPressed.current;
    secondPressed.current = null;
    return pending ? await pending : null;
  }

  function tapDrawing(hit: { page: PageLayout; at: Point } | null) {
    placedByTap.current = null;
    // A callout being typed closes first, like an open item, and Text
    // turns off.
    if (draftRef.current) {
      void commitDraft();
      if (tool === "text") releaseText();
      return;
    }
    // Tapping the drawing closes what's open beside it: an item's editor
    // first (its text is saved), then the Items or Drawings panel. With
    // nothing open and the Pin tool on, it places an instruction pin.
    if (pendingOpen.current) {
      // The pin just placed, about to open: count it as open.
      cancelPendingOpen();
      return;
    }
    if (selectedId) {
      setJustPlaced(null);
      select(null);
      return;
    }
    if (itemsOpen) {
      setItemsOpen(false);
      return;
    }
    // With Text on: a tap on open space just after typing (the box lost
    // focus as the finger went down) or with a callout selected lets go
    // and turns Text off; otherwise it places a box (no leader).
    if (tool === "text") {
      if (selectedCallout || nowMs() - draftClosed.current < CLOSE_TAP_MS)
        releaseText();
      else if (hit) placeText(hit.page, hit.at, null);
      return;
    }
    if (hit && tool === "pin") {
      const time = performance.now();
      placedByTap.current = {
        item: placePin(hit.page, hit.at, { openAt: time + DOUBLE_TAP_MS }),
        time,
      };
    }
  }

  /**
   * A tap and hold (then release), from `press` to `end` (null: not
   * dragged). A new pin goes where the drag ended with its arrowhead at
   * the press (engineer, 2026-10-07: the arrowhead first, then drag the
   * pin out). An instruction is a new pin. An observation (double-tap and
   * hold) moves the pin the first tap placed and turns it into one, with
   * the arrow, in the same Undo step; an existing pin stays put, switches,
   * and gets an arrow to the end; otherwise it places a new observation.
   */
  async function holdPlace(
    page: PageLayout,
    press: Point,
    end: Point | null,
    kind: ItemKind,
    pinId: string | null,
  ) {
    // A new pin: at the end, pointing back at the press.
    const at = end ?? press;
    const arrows = end ? [{ id: crypto.randomUUID(), ...press }] : [];
    placedByTap.current = null;
    if (kind === "instruction") {
      await placePin(page, at, { arrows });
      return;
    }
    // Double-tap and hold: the pin the second press turned moves to the
    // end and gets the arrow.
    const turned = await takeSecondPressed();
    if (turned) {
      const samePage =
        turned.drawingId === page.drawingId && turned.page === page.page;
      if (end && samePage) {
        await switchNewItemKind(
          turned,
          "observation",
          [...(turned.arrows ?? []), ...arrows],
          at,
        );
      }
      openItem(turned.id);
      return;
    }
    const existing = pinId ? itemOf(pinId) : undefined;
    if (existing && pinId) {
      select(existing.id);
      await setKindWithUndo(existing, "observation");
      const spot = itemSpots(existing).find((s) => s.key === pinId);
      if (end && spot) {
        await setArrowsWithUndo(
          existing,
          [...spot.arrows, { id: crypto.randomUUID(), ...end }],
          `Add arrow to observation ${existing.letter}`,
          spot.copyId,
        );
      }
      return;
    }
    await placePin(page, at, { arrows, kind: "observation" });
  }

  /**
   * A double-tap lifted: the pin its second press turned into an
   * observation opens; on an existing pin it switches kind.
   */
  async function doubleTap(
    target: { pinId: string } | { hit: { page: PageLayout; at: Point } | null },
  ) {
    placedByTap.current = null;
    const turned = await takeSecondPressed();
    const pinId = "pinId" in target ? target.pinId : null;
    if (turned) {
      openItem(turned.id);
      return;
    }
    if (pinId === null) {
      // The first tap only closed something: this one is a plain tap.
      if ("hit" in target) tapDrawing(target.hit);
      return;
    }
    const item = itemOf(pinId);
    if (!item) return;
    select(item.id);
    await setKindWithUndo(
      item,
      item.kind === "instruction" ? "observation" : "instruction",
    );
  }

  function renderPageOverlay(page: PageLayout) {
    const box = boxes?.find(
      (b) => b.drawingId === page.drawingId && b.page === page.page,
    );
    if (!inspection) return null;
    // Items with a pin (original or copy) here: the notes box lists them,
    // after the general notes (which every page's box lists).
    const pageItems = (items ?? []).filter((item) =>
      isOnPage(item, page.drawingId, page.page),
    );
    // A page with only general notes shows its box at the default spot
    // until it's moved (then it has a record).
    const shownBox =
      pageItems.length > 0 || generalNotes.length > 0
        ? (box ?? {
            id: "",
            drawingId: page.drawingId,
            page: page.page,
            ...defaultBoxPosition(page.size),
          })
        : null;
    const pageSpots = pageItems.flatMap((item) =>
      itemSpots(item)
        .filter((s) => s.drawingId === page.drawingId && s.page === page.page)
        .map((s) => ({ ...live(s), id: s.key, kind: item.kind })),
    );
    return (
      <>
        <MarkupOverlay
          marks={
            preview?.pageKey === page.key
              ? preview.marks
              : (marksByPage.get(page.key) ?? NO_MARKS)
          }
        />
        <CalloutsOverlay
          callouts={
            preview?.pageKey === page.key
              ? preview.callouts
              : (calloutsByPage.get(page.key) ?? NO_MARKS)
          }
          passive={tool === "select"}
          draft={draft?.pageKey === page.key ? draft : null}
          interactive={tool === "text"}
          selectedId={selectedCallout}
          onTap={tapCallout}
          onDraftText={(text) =>
            putDraft(draftRef.current && { ...draftRef.current, text })
          }
          onDone={() => void commitDraft()}
          onMove={moveCallout}
          onResize={resizeCallout}
        />
        <ArrowsOverlay items={pageSpots} />
        {tool === "select" && selection?.pageKey === page.key && (
          <SelectionOverlay
            marks={preview?.selected ?? selectedMarks}
            dragging={selectDrag !== null}
            onColour={recolourSelection}
            onWeight={reweightSelection}
            onDuplicate={() => void duplicateSelection()}
            onDelete={deleteSelection}
          />
        )}
        {shownBox && (
          <ObservationBoxOverlay
            box={shownBox}
            lines={boxLines({
              header: boxHeader(inspection),
              observationHeading: heading ?? DEFAULT_OBSERVATION_HEADING,
              items: [...generalNotes, ...pageItems],
            })}
            onChange={(to, label) => {
              // Undoable (engineer, 2026-10-20), moves too.
              const before = {
                x: shownBox.x,
                y: shownBox.y,
                width: shownBox.width,
                textSize: shownBox.textSize,
              };
              const save = (values: typeof to) =>
                placeObservationBox(
                  db,
                  page.drawingId,
                  page.page,
                  values,
                  inspectionId,
                );
              void save(to);
              pushUndo(inspectionId, {
                label,
                undo: () => save(before),
                redo: () => save(to),
              });
            }}
          />
        )}
      </>
    );
  }

  if (inspection === undefined || drawings === undefined) return null;
  if (!inspection) {
    return <NotFound what="Inspection" />;
  }

  // The drawing whose sheet it shows (another's for a page moved in).
  const currentDrawing = drawings.find((d) => d.id === current?.pdfDrawingId);
  const showList = drawings.length === 0 || adding.busy || adding.failed;
  const loadError = [...errors.values()][0] ?? backfillError;

  return (
    <section className="drawing-screen">
      <InspectionHeader inspectionId={inspectionId} current="inspection" />
      {drawings.length > 0 && <MarkupToolbar tool={tool} onTool={changeTool} />}
      {loadError && (
        <p role="alert" className="error viewer-alert">
          Could not open a drawing: {loadError}
        </p>
      )}

      <div
        className={`drawing-body${selected || itemsOpen ? " with-sheet" : ""}`}
      >
        {showList ? (
          <div className="drawings-empty">
            <DrawingsSection
              inspectionId={inspectionId}
              onActivity={setAdding}
              onOpen={(drawingId) => {
                setAdding({ busy: false, failed: false });
                setScrollTarget({
                  // A new drawing shows every page: page 1 is its first.
                  pageKey: pageKey(drawingId, 1),
                  token: Date.now(),
                });
              }}
            />
          </div>
        ) : (
          <div className="viewer-wrap">
            {undoNote && (
              <p className="viewer-toast" role="status">
                {undoNote}
              </p>
            )}
            <DocumentViewer
              layout={layout}
              docs={docs}
              pins={pins}
              tool={tool}
              fingerDraw={prefs.fingerDraw}
              predict={prefs.predict}
              diagnostics={prefs.diagnostics}
              marks={docMarks}
              ink={{
                colour: toolColour(prefs, inkTool),
                weight: prefs.weight[inkTool],
                opacity: inkTool === "highlighter" ? HIGHLIGHTER_OPACITY : 1,
                shape: tool === "shapes" ? prefs.shape : null,
              }}
              onStroke={saveStroke}
              onErase={erase}
              onUnfill={unfill}
              onPlaceText={placeText}
              selection={tool === "select" ? selection : null}
              onSelectMarks={selectMarks}
              onTapMark={tapMark}
              onUndoGesture={undoByGesture}
              onSelectTapAgain={(id) => {
                const mark = docMarks.find((m) => m.id === id);
                if (mark?.tool === "text") editCallout(mark);
              }}
              onSelectDrag={dragSelection}
              addPinMode={placingArrow !== null || copying !== null}
              onPlacePin={(page, at) =>
                void (copying
                  ? placeCopy(page, at)
                  : placingArrow
                    ? placeArrow(page, at)
                    : placePin(page, at))
              }
              onMovePin={(key, to) => setDragging((d) => ({ ...d, [key]: to }))}
              onMovePinEnd={(key, to) => {
                const { itemId, copyId } = parseSpotKey(key);
                void (
                  copyId
                    ? updateCopy(db, itemId, copyId, to)
                    : updateItem(db, itemId, to)
                ).then(() =>
                  setDragging((d) => {
                    const rest = { ...d };
                    delete rest[key];
                    return rest;
                  }),
                );
              }}
              onSelectPin={(key) => select(parseSpotKey(key).itemId)}
              onTapDrawing={tapDrawing}
              onSecondPress={secondPress}
              onDoubleTap={(target) => void doubleTap(target)}
              onHoldPlace={(page, at, tip, kind, pinId) =>
                void holdPlace(page, at, tip, kind, pinId)
              }
              onSelectArrow={(key, arrowId) => {
                select(parseSpotKey(key).itemId);
                setSelectedArrow(arrowId);
              }}
              onMoveArrow={(key, arrowId, to) =>
                setDraggingArrow({ key, arrowId, to })
              }
              onMoveArrowEnd={(key, arrowId, to) => {
                const item = itemOf(key);
                const spot = item && itemSpots(item).find((s) => s.key === key);
                if (!item || !spot) return;
                setSelectedArrow(arrowId);
                void setArrowsWithUndo(
                  item,
                  spot.arrows.map((a) =>
                    a.id === arrowId ? { ...a, ...to } : a,
                  ),
                  "Move arrow",
                  spot.copyId,
                ).then(() => setDraggingArrow(null));
              }}
              onCurrentPage={(page) => {
                setCurrent(page);
                writePlace(`doc-page:${inspectionId}`, page.key);
              }}
              onActiveDrawings={setNeeded}
              onVisiblePins={(keys) =>
                setPinsInView(new Set(keys.map((k) => parseSpotKey(k).itemId)))
              }
              renderPageOverlay={renderPageOverlay}
              scrollTarget={scrollTarget}
              coveredBy={() =>
                document.querySelector(".drawing-body > .item-sheet")
              }
              fitRequest={fitRequest}
            />
            {/* Floating over the drawing: they never move it. Both pills sit
                on the right edge (easier for the right hand on site); the
                panels open on the left. */}
            <div className="viewer-controls">
              {/* The page and Items. */}
              <div className="viewer-side">
                <button
                  type="button"
                  className="side-button"
                  aria-label="Pages"
                  aria-haspopup="dialog"
                  title={
                    currentDrawing && current
                      ? `${currentDrawing.name} · page ${current.source} of ${current.pageCount}`
                      : "Pages"
                  }
                  onClick={() => {
                    setPagesOpen(true);
                    setItemsOpen(false);
                    select(null);
                  }}
                >
                  <Files aria-hidden="true" />
                  <span
                    className="side-label"
                    data-testid="page-indicator"
                    // Which drawing and its own page, for tests and tooltips.
                    data-label={
                      currentDrawing && current
                        ? `${currentDrawing.name} · page ${current.source} of ${current.pageCount}`
                        : ""
                    }
                  >
                    {/* "Page" above "N of M" in the narrow pill. */}
                    {current && (
                      <>
                        Page{" "}
                        <span className="side-label-line">
                          {current.number} of {layout.pages.length}
                        </span>
                      </>
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  className={`side-button${itemsOpen ? " toggle-on" : ""}`}
                  aria-label="Items"
                  aria-pressed={itemsOpen}
                  title="Items"
                  onClick={() => {
                    setItemsOpen((open) => !open);
                    select(null);
                  }}
                >
                  <List aria-hidden="true" />
                  <span className="side-label">
                    Items
                    {(items?.length ?? 0) > 0 && (
                      <span className="count-badge" aria-hidden="true">
                        {items?.length}
                      </span>
                    )}
                  </span>
                </button>
              </div>
              {/* Tools: a vertical pill below (pins and markup are in the
                  toolbar above the drawing). */}
              <div
                className="viewer-tools"
                role="toolbar"
                aria-label="Drawing tools"
                aria-orientation="vertical"
              >
                <QuickPhotoButton inspectionId={inspectionId} />
                <button
                  type="button"
                  className="icon-button quiet"
                  aria-label="Undo"
                  disabled={!history.undo}
                  title={
                    history.undo
                      ? `Undo: ${history.undo.label}`
                      : "Nothing to undo"
                  }
                  onClick={() => {
                    // An undone change could leave the open sheet pointing at nothing.
                    select(null);
                    void undoLast(inspectionId);
                  }}
                >
                  <Undo2 aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="icon-button quiet"
                  aria-label="Redo"
                  disabled={!history.redo}
                  title={
                    history.redo
                      ? `Redo: ${history.redo.label}`
                      : "Nothing to redo"
                  }
                  onClick={() => {
                    select(null);
                    void redoLast(inspectionId);
                  }}
                >
                  <Redo2 aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="icon-button quiet"
                  aria-label="Fit page"
                  title="Fit page"
                  onClick={() => setFitRequest((n) => n + 1)}
                >
                  <Maximize aria-hidden="true" />
                </button>
              </div>
            </div>
            {copying && selected && (
              <p className="viewer-hint viewer-hint-copy" role="status">
                Tap each spot for a copy of {kindName(selected.kind)}{" "}
                {selected.letter}
                <button type="button" onClick={() => setCopying(null)}>
                  Done
                </button>
              </p>
            )}
            {items && tool !== "pin" && (
              <ExportedLettersNotice
                inspectionId={inspectionId}
                items={items}
              />
            )}
          </div>
        )}

        {selected ? (
          <ItemSheet
            key={selected.id}
            item={selected}
            autoFocus={selected.id === justPlaced}
            closeLabel={itemsOpen ? "‹ Items" : "Done"}
            onClose={() => {
              setJustPlaced(null);
              select(null);
            }}
            arrows={{
              placing: placingArrow === selected.id,
              selectedId: selectedArrow,
              message: arrowMessage,
              onAdd: () => {
                setCopying(null);
                setPlacingArrow(selected.id);
                setArrowMessage(null);
              },
              onCancel: () => {
                setPlacingArrow(null);
                setArrowMessage(null);
              },
              onRemove: (arrowId) => {
                const spot = itemSpots(selected).find((s) =>
                  s.arrows.some((a) => a.id === arrowId),
                );
                if (!spot) return;
                setSelectedArrow(null);
                void setArrowsWithUndo(
                  selected,
                  spot.arrows.filter((a) => a.id !== arrowId),
                  `Remove arrow from ${kindName(selected.kind).toLowerCase()} ${selected.letter}`,
                  spot.copyId,
                );
              },
            }}
            copies={{
              copying: copying === selected.id,
              spots: itemSpots(selected).map((s) => ({
                key: s.key,
                copyId: s.copyId,
                label: pageLabel(s.drawingId, s.page),
              })),
              onCopy: () => {
                setPlacingArrow(null);
                setArrowMessage(null);
                setCopying(selected.id);
              },
              onStop: () => setCopying(null),
              onGoTo: (key) => {
                const spot = itemSpots(selected).find((s) => s.key === key);
                if (spot)
                  setScrollTarget({
                    pageKey: pageKey(spot.drawingId, spot.page),
                    at: { x: spot.x, y: spot.y },
                    token: Date.now(),
                  });
              },
              onRemove: (copyId) => void removeSpotWithUndo(selected, copyId),
            }}
          />
        ) : (
          itemsOpen && (
            <ItemsPanel
              items={items ?? []}
              drawings={drawings}
              inView={pinsInView}
              onClose={() => setItemsOpen(false)}
              onAddGeneral={() =>
                void createGeneralNoteWithUndo(inspectionId).then((created) =>
                  select(created.id),
                )
              }
              onSelect={(item) => {
                select(item.id);
                // A general note has no pin to scroll to.
                if (item.general) return;
                setScrollTarget({
                  pageKey: pageKey(item.drawingId, item.page),
                  at: { x: item.x, y: item.y },
                  token: Date.now(),
                });
              }}
            />
          )
        )}
      </div>
      <PagesSheet
        open={pagesOpen}
        inspectionId={inspectionId}
        drawings={drawings}
        items={items ?? []}
        marks={marks ?? []}
        currentKey={current?.key ?? null}
        onGoTo={(key) => setScrollTarget({ pageKey: key, token: Date.now() })}
        onClose={() => {
          setPagesOpen(false);
          if (params.has("pages")) setParams({}, { replace: true });
        }}
      />
    </section>
  );
}
