import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { PDFDocumentProxy } from "../pdf/pdfjs";
import {
  clampNormalised,
  panBy,
  pageToScreen,
  screenToPage,
  zoomAt,
  type Point,
  type Size,
  type ViewTransform,
} from "../viewer/viewTransform";
import { kindName } from "../../items/letters";
import {
  SHAPE_FILL_OPACITY,
  drawMark,
  insideMark,
  markWidth,
  shapeDrawing,
  simplify,
  strokePath,
  toPagePoints,
  touchesMark,
} from "../../markup/markGeometry";
import type { HeldShape, MarkupShape } from "../../../db/types";
import { recogniseShape } from "../../markup/shapeRecognition";
import {
  clampMove,
  marksInLoop,
  pickMark,
  ROTATE_OFFSET_PX,
  rotateHandle,
  selectionBounds,
  shapeHandles,
  type HandleId,
} from "../../markup/selectGeometry";
import { isInkTool, type DocMark, type ViewerTool } from "../../markup/tools";
import { DocPage, type SettledView } from "./DocPage";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { diagnostics, noteScroll } from "./diagnostics";
import { useSavePagesAhead } from "./savedPages";
import { DOUBLE_TAP_MS, DOUBLE_TAP_SLOP } from "./gestures";
import { PinchSnapshot } from "./pinchSnapshot";
import {
  DOC_WIDTH,
  hitPage,
  pageAtY,
  pagePointToDoc,
  pagesInRange,
  type DocumentLayout,
  type PageLayout,
} from "./documentLayout";

/** The marks the Select tool has picked, all on one page. */
export interface MarkSelection {
  pageKey: string;
  ids: string[];
}

/** A selection being dragged (normalised on its page). */
export type SelectDrag =
  | { kind: "move"; dx: number; dy: number }
  | {
      kind: "handle";
      handle: HandleId;
      to: Point;
      /** Where the handle was grabbed (turning measures from it). */
      from: Point;
    };

export interface DocPin {
  id: string;
  letter: string;
  pageKey: string;
  /** Normalised position on its page (0..1). */
  x: number;
  y: number;
  kind: "instruction" | "observation";
  selected: boolean;
  /** Arrow tips (normalised on the pin's page); handles show when selected. */
  arrows: { id: string; x: number; y: number }[];
  selectedArrowId: string | null;
}

/** Where to scroll: a drawing's first page, or a point on a page. */
export interface ScrollTarget {
  pageKey: string;
  at?: Point;
  /** Change to repeat a request for the same target. */
  token: number;
}

interface Props {
  layout: DocumentLayout;
  docs: Map<string, PDFDocumentProxy>;
  pins: DocPin[];
  /**
   * The markup toolbar's tool (SPEC section 5a). Pin gestures (tap,
   * double-tap, hold) place pins only while it is "pin"; pen, highlighter
   * and eraser draw with the Pencil (or a finger with `fingerDraw`).
   */
  tool: ViewerTool | null;
  /** Draw with finger: one finger draws, two scroll and zoom. */
  fingerDraw: boolean;
  /** Extend the stroke being drawn to the iPad's predicted Pencil points. */
  predict: boolean;
  /** Show the diagnostics panel (Settings, Drawing; step 10). */
  diagnostics?: boolean;
  /** Saved pen and highlighter marks (for the eraser and the pinch snapshot). */
  marks: DocMark[];
  /** The tool's look while drawing; `shape` when the Shapes tool is on. */
  ink: {
    colour: string;
    weight: number;
    opacity: number;
    shape: MarkupShape | null;
  };
  /**
   * A finished stroke or shape: normalised points on the page it started on
   * (a shape: where the drag started and ended). `shape` is set for the
   * Shapes tool, and "line" for a pen stroke straightened by holding.
   */
  onStroke: (
    page: PageLayout,
    points: Point[],
    shape: MarkupShape | HeldShape | null,
    /** A held rectangle or ellipse drawn at an angle (radians). */
    rotation?: number,
  ) => Promise<void>;
  /** The marks the eraser has touched so far; `done` when it lifts. */
  onErase: (ids: string[], done: boolean) => void;
  /** The eraser tapped inside a filled shape: take its fill off. */
  onUnfill: (id: string) => void;
  /**
   * The Text tool's tap and hold (then drag) placed a callout: dragged, its
   * box at the lift (the corner nearest the tip there) and its leader's tip
   * at the press; not dragged, its top-left at the press and no leader
   * (`tip` null). Normalised on `page`. A plain tap with Text on comes
   * through `onTapDrawing`.
   */
  onPlaceText: (page: PageLayout, box: Point, tip: Point | null) => void;
  /** The Select tool's picked marks (SPEC section 5a, slice 2d). */
  selection: MarkSelection | null;
  /** A tap or loop picked these marks (none: let go). */
  onSelectMarks: (selection: MarkSelection | null) => void;
  /**
   * A tap on a mark with no tool, the pen, highlighter or a shape tool
   * (engineer, 2026-10-07): pick it, switching to Select. `hit` is the spot.
   */
  onTapMark: (
    selection: MarkSelection,
    hit: { page: PageLayout; at: Point },
  ) => void;
  /** The one mark selected was tapped again (a callout: edit its text). */
  onSelectTapAgain: (markId: string) => void;
  /**
   * The selection (or one shape's handle) is being dragged; `done` when
   * it lifts (`drag` null: it didn't move).
   */
  onSelectDrag: (drag: SelectDrag | null, done: boolean) => void;
  /** While true, every tap (finger, Pencil or mouse) places an arrow or copy. */
  addPinMode: boolean;
  onPlacePin: (page: PageLayout, at: Point) => void;
  onMovePin: (id: string, to: Point) => void;
  onMovePinEnd: (id: string, to: Point) => void;
  onSelectPin: (id: string) => void;
  /**
   * Tap, hold, (drag,) release on the drawing, from `press` to `end` (null:
   * not dragged), on the press's page: a new pin goes at the end with its
   * arrowhead at the press (engineer, 2026-10-07). After a tap (double-tap
   * and hold) the kind is observation, and `pinId` names the pin pressed,
   * when the hold started on one: one that was already there stays put and
   * its arrow points to the end instead.
   */
  onHoldPlace: (
    page: PageLayout,
    press: Point,
    end: Point | null,
    kind: "instruction" | "observation",
    pinId: string | null,
  ) => void;
  /**
   * The second press of a double-tap has gone down (before it lifts or
   * becomes a hold): on a pin (often the one the first tap just placed),
   * or on the drawing.
   */
  onSecondPress: (
    target: { pinId: string } | { hit: { page: PageLayout; at: Point } | null },
  ) => void;
  /**
   * The second tap of a double-tap: on a pin (often the one the first tap
   * just placed), or on the drawing (with the spot, null between pages).
   */
  onDoubleTap: (
    target: { pinId: string } | { hit: { page: PageLayout; at: Point } | null },
  ) => void;
  /**
   * A tap on the drawing away from pins, outside Add pin / Add arrow, with
   * the page spot it landed on (null between pages).
   */
  onTapDrawing: (hit: { page: PageLayout; at: Point } | null) => void;
  /** Arrow tip handles (the selected item's): tap selects, drag moves. */
  onSelectArrow: (itemId: string, arrowId: string) => void;
  onMoveArrow: (itemId: string, arrowId: string, to: Point) => void;
  onMoveArrowEnd: (itemId: string, arrowId: string, to: Point) => void;
  /** Two fingers tapped twice (GoodNotes style): undo. */
  onUndoGesture: () => void;
  /** The page at the centre of the view changed. */
  onCurrentPage: (page: PageLayout) => void;
  /** Drawings with pages on or near the screen (their PDFs are needed). */
  onActiveDrawings: (drawingIds: string[]) => void;
  /** Items whose pins are on screen changed. */
  onVisiblePins: (itemIds: string[]) => void;
  renderPageOverlay: (page: PageLayout) => ReactNode;
  scrollTarget: ScrollTarget | null;
  /** A panel floating over the view, if any: scroll targets stay clear of it. */
  coveredBy?: () => Element | null;
  /** Change to fit the current page to the view. */
  fitRequest: number;
}

const TAP_SLOP = 10;
const TAP_MS = 600;
const SETTLE_MS = 160;
const PAD = 16;
/** A touch this soon after the view scrolled stops the scroll; it isn't a tap. */
const SCROLL_STOP_MS = 120;
/** Holding this long without moving starts a pin with an arrow. */
const HOLD_MS = 500;
/** The eraser removes marks within this many screen px of it. */
const ERASER_REACH = 10;
/** A pen stroke held still this long at its end straightens into a line. */
const STRAIGHTEN_MS = 500;
/** "Still" for that: within this many screen px. */
const STILL_SLOP = 6;
/** Shapes dragged out less than this (screen px) aren't drawn. */
const MIN_SHAPE = 6;
/** A stroke is simplified to within this many screen px when saved. */
const STROKE_TOLERANCE = 0.25;
/**
 * A two-finger tap: both fingers down and up within this long, moving less
 * than TWO_TAP_SLOP; two of them within TWO_TAP_GAP make an undo.
 */
const TWO_TAP_MS = 300;
const TWO_TAP_SLOP = 12;
const TWO_TAP_GAP = 450;
/** Screen px of grab round a selected shape's handles and its box. */
const HANDLE_REACH = 22;
const SELECT_MARGIN = 8;
/** Released closer to the pin than this, the hold places just the pin. */
const ARROW_MIN = 24;
/** The hold ring shows only once a press has lasted this long. */
const RING_DELAY_MS = 150;

interface Tracked extends Point {
  type: string;
}

/** The parts of a touch the pinch needs (tests can supply plain objects). */
interface TouchLike {
  clientX: number;
  clientY: number;
  touchType?: string;
}

/** Milliseconds since a performance.now() time (event handlers only). */
function msSince(time: number) {
  return performance.now() - time;
}

function capture(e: React.PointerEvent) {
  try {
    e.currentTarget.setPointerCapture(e.pointerId);
  } catch {
    // Pointer already released.
  }
}

/**
 * Every page of every drawing in one continuous, vertically stacked document
 * (GoodNotes style). One-finger scrolling is the browser's own (on iPad:
 * Safari's 120 Hz scrolling with iOS momentum and bounce). Two fingers
 * pinch-zoom; mouse drags pan, the wheel scrolls and ctrl+wheel zooms. At
 * fit width the document is exactly as wide as the view, so it can't move
 * sideways. Apple Pencil never scrolls; its taps act like a finger's. Only
 * pages on or near the screen are rendered.
 *
 * The scroll container's content is the document at the current zoom: a
 * point at document units (x, y) sits at (padX + x * scale, PAD + y * scale)
 * in the content. `transform` describes the same view as before
 * (screen = doc * scale + offset), derived from the scroll position.
 */
export function DocumentViewer(props: Props) {
  const { layout, docs, pins, addPinMode, scrollTarget, fitRequest } = props;
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const sizerRef = useRef<HTMLDivElement>(null);
  /** The picture a pinch moves (see pinchSnapshot.ts), and its host. */
  const snapshotHostRef = useRef<HTMLDivElement>(null);
  const snapshot = useRef<PinchSnapshot | null>(null);
  /** The stroke being drawn (cleared once it is saved). */
  const inkRef = useRef<HTMLCanvasElement>(null);
  const snapshotRelease = useRef(0);
  /** Pages on or near the screen (rendered), as last laid out. */
  const activeRef = useRef<Set<string>>(new Set());
  const stageRef = useRef<HTMLDivElement>(null);
  const pinEls = useRef(new Map<string, HTMLElement>());
  const transform = useRef<ViewTransform>({ scale: 1, x: PAD, y: PAD });
  const viewSize = useRef<Size>({ width: 0, height: 0 });
  const fitWidthScale = useRef(1);
  /** What the content is currently sized for. */
  const applied = useRef({ scale: 0, viewWidth: 0, docHeight: 0 });
  const lastScroll = useRef(-Infinity);
  const frame = useRef(0);
  const settleTimer = useRef(0);
  const currentKey = useRef<string | null>(null);
  const visiblePinsKey = useRef<string | null>(null);
  const visiblePinsTimer = useRef(0);
  /** Cancels page drawing in progress (pages register while drawing). */
  const renderCancels = useRef(new Set<() => void>());
  const registerRender = useCallback((cancel: () => void) => {
    renderCancels.current.add(cancel);
    return () => {
      renderCancels.current.delete(cancel);
    };
  }, []);
  const [activeKeys, setActiveKeys] = useState<Set<string>>(() => new Set());
  const [settled, setSettled] = useState<SettledView | null>(null);
  /** Scrolling or zooming: pages hold off full-detail drawing (step 10b). */
  const [moving, setMoving] = useState(false);
  const movingRef = useRef(false);
  const [renderedKeys, setRenderedKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [currentPageKey, setCurrentPageKey] = useState<string | null>(null);
  // Saved page images: the pages not saved yet are drawn and saved ahead
  // while the document is still (savedPages.ts).
  useSavePagesAhead({
    layout,
    docs,
    fitQuality: settled?.fitDevicePxPerDocUnit ?? 0,
    moving,
    currentKey: currentPageKey,
    activeKeys,
  });

  const pagesByKey = useMemo(
    () => new Map(layout.pages.map((p) => [p.key, p])),
    [layout],
  );
  // Handlers outlive renders, so they read the latest layout through refs.
  const pagesRef = useRef(pagesByKey);
  useLayoutEffect(() => {
    pagesRef.current = pagesByKey;
  });
  const currentLayout = () => latest.current.layout;

  // --- layout -------------------------------------------------------------

  /** Left margin of the document in the content (centres it when narrow). */
  function padX(scale: number) {
    return Math.max(PAD, (viewSize.current.width - DOC_WIDTH * scale) / 2);
  }

  function visibleDocRange(t: ViewTransform) {
    const top = screenToPage(t, { x: 0, y: 0 });
    const bottom = screenToPage(t, {
      x: viewSize.current.width,
      y: viewSize.current.height,
    });
    return { top, bottom };
  }

  function positionPins() {
    const scale = applied.current.scale;
    const left = padX(scale);
    for (const pin of latest.current.pins) {
      const el = pinEls.current.get(pin.id);
      const page = pagesRef.current.get(pin.pageKey);
      if (!el || !page) continue;
      const p = pagePointToDoc(page, pin);
      el.style.transform = `translate(${left + p.x * scale}px, ${PAD + p.y * scale}px)`;
      for (const arrow of pin.arrows) {
        const handle = pinEls.current.get(`${pin.id}:${arrow.id}`);
        if (!handle) continue;
        const a = pagePointToDoc(page, arrow);
        handle.style.transform = `translate(${left + a.x * scale}px, ${PAD + a.y * scale}px)`;
      }
    }
  }

  /** Sizes the content for a zoom level (only when something changed). */
  function applyScale(scale: number) {
    const docHeight = currentLayout().height;
    const a = applied.current;
    if (
      a.scale === scale &&
      a.viewWidth === viewSize.current.width &&
      a.docHeight === docHeight
    )
      return;
    applied.current = {
      scale,
      viewWidth: viewSize.current.width,
      docHeight,
    };
    const left = padX(scale);
    const width = DOC_WIDTH * scale + 2 * left;
    // At (or below) fit width there's nothing to see sideways: lock it.
    const fits = width <= viewSize.current.width + 0.5;
    containerRef.current!.style.overflowX = fits ? "hidden" : "auto";
    Object.assign(sizerRef.current!.style, {
      width: `${fits ? viewSize.current.width : width}px`,
      height: `${Math.max(docHeight, 1) * scale + 2 * PAD}px`,
    });
    stageRef.current!.style.transform = `translate(${left}px, ${PAD}px) scale(${scale})`;
    positionPins();
  }

  function layoutFrame() {
    frame.current = 0;
    const t = transform.current;
    // Pages within one screen above/below stay rendered.
    const { top, bottom } = visibleDocRange(t);
    const span = bottom.y - top.y;
    const active = pagesInRange(currentLayout(), top.y, bottom.y, span);
    const nextActive = new Set(active.map((p) => p.key));
    activeRef.current = nextActive;
    setActiveKeys((old) =>
      nextActive.size === old.size && [...nextActive].every((k) => old.has(k))
        ? old
        : nextActive,
    );
    // The current page is the one a third of the way down the view, where
    // the eye reads: with two short pages on screen (portrait), the centre
    // can fall on the next page while this one fills the top.
    const centre = pageAtY(currentLayout(), top.y + (bottom.y - top.y) / 3);
    if (centre && centre.key !== currentKey.current) {
      currentKey.current = centre.key;
      setCurrentPageKey(centre.key);
      latest.current.onCurrentPage(centre);
    }
    // Which pins are on screen, once movement pauses (it re-renders the
    // Items list, which mustn't happen every frame of a scroll).
    window.clearTimeout(visiblePinsTimer.current);
    visiblePinsTimer.current = window.setTimeout(reportVisiblePins, 120);
  }

  /** Tells the parent which pins are on screen (the Items list highlights them). */
  function reportVisiblePins() {
    const t = transform.current;
    const { width, height } = viewSize.current;
    const onScreen = latest.current.pins
      .filter((pin) => {
        const page = pagesRef.current.get(pin.pageKey);
        if (!page) return false;
        const p = pageToScreen(t, pagePointToDoc(page, pin));
        return p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height;
      })
      .map((pin) => pin.id)
      .sort()
      .join(",");
    if (onScreen !== visiblePinsKey.current) {
      visiblePinsKey.current = onScreen;
      latest.current.onVisiblePins(onScreen ? onScreen.split(",") : []);
    }
  }

  function requestLayout() {
    if (!frame.current) frame.current = requestAnimationFrame(layoutFrame);
  }

  function settle() {
    movingRef.current = false;
    setMoving(false);
    const t = transform.current;
    const { top, bottom } = visibleDocRange(t);
    const dpr = window.devicePixelRatio || 1;
    const visible = pagesInRange(currentLayout(), top.y, bottom.y);
    diagnostics.view = {
      zoom: t.scale / fitWidthScale.current,
      dpr,
      visibleKeys: visible.map((p) => p.key),
    };
    setSettled({
      docRect: {
        x: top.x,
        y: top.y,
        width: bottom.x - top.x,
        height: bottom.y - top.y,
      },
      devicePxPerDocUnit: t.scale * dpr,
      fitDevicePxPerDocUnit: fitWidthScale.current * dpr,
      visibleCount: Math.max(1, visible.length),
    });
  }

  /**
   * The view from the live scroll position. Pointer handlers call this
   * rather than trusting the last scroll event, which the browser may not
   * have delivered yet (it fires once per frame).
   */
  function currentTransform(): ViewTransform {
    const c = containerRef.current!;
    const scale = applied.current.scale;
    transform.current = {
      scale,
      x: padX(scale) - c.scrollLeft,
      y: PAD - c.scrollTop,
    };
    return transform.current;
  }

  /** Reads the view from the scroll position (the browser keeps it in range). */
  function readScroll() {
    if (!movingRef.current) {
      movingRef.current = true;
      setMoving(true);
    }
    currentTransform();
    requestLayout();
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(settle, SETTLE_MS);
  }

  function setTransform(next: ViewTransform) {
    applyScale(next.scale);
    const c = containerRef.current!;
    c.scrollLeft = padX(next.scale) - next.x;
    c.scrollTop = PAD - next.y;
    readScroll();
  }

  function zoomLimits() {
    return {
      min: fitWidthScale.current * 0.3,
      max: Math.max(fitWidthScale.current * 24, 4),
    };
  }

  function measure() {
    const c = containerRef.current!;
    viewSize.current = { width: c.clientWidth, height: c.clientHeight };
    fitWidthScale.current = Math.max(
      0.01,
      (viewSize.current.width - 2 * PAD) / DOC_WIDTH,
    );
  }

  /** Whole page in view, centred. */
  function fitPage(page: PageLayout): ViewTransform {
    const { width, height } = viewSize.current;
    const scale = Math.min(
      (width - 2 * PAD) / DOC_WIDTH,
      (height - 2 * PAD) / page.height,
    );
    return {
      scale,
      x: (width - DOC_WIDTH * scale) / 2,
      y: (height - page.height * scale) / 2 - page.top * scale,
    };
  }

  /** Fit width with the page's top at the top of the view. */
  function topOfPage(page: PageLayout): ViewTransform {
    const scale = fitWidthScale.current;
    return { scale, x: PAD, y: PAD - page.top * scale };
  }

  function keepSelectedVisible(t: ViewTransform): ViewTransform {
    const pin = latest.current.pins.find((p) => p.selected);
    const page = pin && pagesRef.current.get(pin.pageKey);
    if (!pin || !page) return t;
    const p = pageToScreen(t, pagePointToDoc(page, pin));
    const margin = 40;
    const { width, height } = viewSize.current;
    const dx =
      p.x < margin
        ? margin - p.x
        : p.x > width - margin
          ? width - margin - p.x
          : 0;
    const dy =
      p.y < margin
        ? margin - p.y
        : p.y > height - margin
          ? height - margin - p.y
          : 0;
    return dx || dy ? panBy(t, dx, dy) : t;
  }

  // First layout, and whenever the set of pages changes.
  const initialised = useRef(false);
  useLayoutEffect(() => {
    measure();
    if (!initialised.current && layout.pages.length) {
      initialised.current = true;
      transform.current = { scale: fitWidthScale.current, x: PAD, y: PAD };
    }
    setTransform(transform.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  /** The part of the view (local px) not covered by a floating panel. */
  function clearArea() {
    const { width, height } = viewSize.current;
    const area = { left: 0, top: 0, right: width, bottom: height };
    const panel = latest.current.coveredBy?.();
    if (!panel) return area;
    const view = containerRef.current!.getBoundingClientRect();
    const r = panel.getBoundingClientRect();
    // A tall panel runs down the left (landscape); else it is along the
    // bottom (portrait).
    if (r.height >= view.height * 0.6)
      area.left = Math.min(width, Math.max(0, r.right - view.left));
    else area.bottom = Math.max(0, Math.min(height, r.top - view.top));
    return area;
  }

  // Scroll requests (opening at a drawing or an item).
  useEffect(() => {
    if (!scrollTarget) return;
    hideSnapshot();
    const page = pagesRef.current.get(scrollTarget.pageKey);
    if (!page) return;
    if (scrollTarget.at) {
      const fitted = fitPage(page);
      const p = pageToScreen(fitted, pagePointToDoc(page, scrollTarget.at));
      const area = clearArea();
      // Fit the page, then centre the point (in the part of the view no
      // panel covers) if it would be near an edge or under the panel.
      const inView =
        p.x > area.left + 40 &&
        p.x < area.right - 40 &&
        p.y > area.top + 40 &&
        p.y < area.bottom - 40;
      setTransform(
        inView
          ? fitted
          : panBy(
              fitted,
              (area.left + area.right) / 2 - p.x,
              (area.top + area.bottom) / 2 - p.y,
            ),
      );
    } else {
      setTransform(topOfPage(page));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollTarget?.token, scrollTarget?.pageKey, layout]);

  useEffect(() => {
    if (!fitRequest) return;
    hideSnapshot();
    const page = currentKey.current && pagesRef.current.get(currentKey.current);
    if (page) setTransform(fitPage(page));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitRequest]);

  useLayoutEffect(() => {
    positionPins();
    // Added, moved or deleted pins can change which are on screen.
    requestLayout();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pins]);

  // Tell the parent which drawings' PDFs are needed.
  const activeDrawingsKey = [
    ...new Set(
      [...activeKeys]
        .map((k) => pagesByKey.get(k)?.pdfDrawingId)
        .filter(Boolean),
    ),
  ]
    .sort()
    .join(",");
  useEffect(() => {
    latest.current.onActiveDrawings(
      activeDrawingsKey ? activeDrawingsKey.split(",") : [],
    );
  }, [activeDrawingsKey]);

  // Follow container size changes.
  useEffect(() => {
    const container = containerRef.current!;
    const observer = new ResizeObserver(() => {
      hideSnapshot();
      const old = viewSize.current;
      const { clientWidth: width, clientHeight: height } = container;
      if (width === old.width && height === old.height) return;
      const wasFitWidth =
        Math.abs(currentTransform().scale - fitWidthScale.current) < 1e-6;
      const widthChanged = Math.abs(width - old.width) > 1;
      const centreDocY = screenToPage(currentTransform(), {
        x: 0,
        y: old.height / 2,
      }).y;
      measure();
      // Rotation / split view: keep fit-width if it was. Height-only changes
      // (an item sheet opening below) keep the view where it is.
      if (wasFitWidth && widthChanged) {
        const scale = fitWidthScale.current;
        setTransform({ scale, x: PAD, y: height / 2 - centreDocY * scale });
        return;
      }
      setTransform(keepSelectedVisible(currentTransform()));
    });
    observer.observe(container);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      window.clearTimeout(settleTimer.current);
      cancelAnimationFrame(frame.current);
      window.clearTimeout(visiblePinsTimer.current);
    },
    [],
  );

  // --- pinch snapshot -----------------------------------------------------

  useEffect(() => {
    const s = new PinchSnapshot(snapshotHostRef.current!);
    snapshot.current = s;
    return () => {
      window.clearTimeout(snapshotRelease.current);
      s.dispose();
      snapshot.current = null;
    };
  }, []);

  /** Shows a snapshot of the view, in place of the document, for a pinch. */
  function captureSnapshot(base: ViewTransform) {
    window.clearTimeout(snapshotRelease.current);
    snapshot.current?.capture({
      view: viewSize.current,
      transform: base,
      pages: currentLayout().pages,
      pins: latest.current.pins,
      marks: latest.current.marks,
      container: containerRef.current!,
    });
  }

  function hideSnapshot() {
    window.clearTimeout(snapshotRelease.current);
    snapshot.current?.hide();
  }

  /** Whether the pages on screen have drawn (and none is still sharpening). */
  function pagesReady() {
    if (renderCancels.current.size > 0) return false;
    const container = containerRef.current!;
    return [...activeRef.current].every(
      (key) =>
        container
          .querySelector(`.doc-page[data-key="${CSS.escape(key)}"]`)
          ?.getAttribute("data-rendered") === "true",
    );
  }

  /**
   * After a pinch the document is laid out at the new zoom under the
   * snapshot (which already shows that zoom); the snapshot goes once the
   * pages have redrawn and sharpened, so that work happens while nothing
   * on screen moves.
   */
  function releaseSnapshotWhenReady() {
    const start = msSince(0);
    const check = () => {
      const elapsed = msSince(start);
      if ((elapsed > SETTLE_MS + 60 && pagesReady()) || elapsed > 1500)
        return hideSnapshot();
      snapshotRelease.current = window.setTimeout(check, 50);
    };
    window.clearTimeout(snapshotRelease.current);
    snapshotRelease.current = window.setTimeout(check, SETTLE_MS + 60);
  }

  // --- input --------------------------------------------------------------

  const pointers = useRef(new Map<number, Tracked>());
  const tap = useRef<{ id: number; start: Point; time: number } | null>(null);
  /**
   * A press that may become a hold: `held` once it has lasted HOLD_MS.
   * Then the viewer owns the touch (no scrolling) until it lifts.
   */
  const hold = useRef<{
    pointerId: number;
    /** Where the finger went down, and where the pin (and arrow) start. */
    start: Point;
    origin: Point;
    page: PageLayout;
    at: Point;
    /** "text": the Text tool's hold, a callout with its leader. */
    kind: "instruction" | "observation" | "text";
    /** The pin pressed (double-tap and hold on a pin). */
    pinId: string | null;
    /**
     * The arrowhead stays at the press and the pin (or box) follows the
     * drag (engineer, 2026-10-07); false for a pin that was already there,
     * whose arrow follows the drag instead.
     */
    headFirst: boolean;
    timer: number;
    ringTimer: number;
    held: boolean;
    /** Where it was dragged to, on the page (null: not dragged). */
    end: Point | null;
  } | null>(null);
  const holdRef = useRef<HTMLDivElement>(null);
  /** The last tap (drawing or pin), to spot a double-tap. */
  const lastTap = useRef<{ at: Point; time: number; onPin: boolean } | null>(
    null,
  );
  /** A touch that stopped a scroll: it never counts as a tap. */
  const stopTouch = useRef<number | null>(null);
  const pinch = useRef<{
    startDist: number;
    startMid: Point;
    /** The viewer's top-left on screen. */
    origin: Point;
    /** Pending preview update (one per frame). */
    frame: number;
    /** The view when the pinch started (what the content is laid out for). */
    base: ViewTransform;
    /** The view the fingers are asking for; laid out when they lift. */
    target: ViewTransform;
  } | null>(null);
  const dragging = useRef<{
    id: string;
    /** Set when dragging one of the pin's arrow tips instead of the pin. */
    arrowId: string | null;
    pointerId: number;
    start: Point;
    moved: boolean;
    last: Point | null;
  } | null>(null);

  function local(e: { clientX: number; clientY: number }): Point {
    const box = containerRef.current!.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  }

  function penDown() {
    return [...pointers.current.values()].some((p) => p.type === "pen");
  }

  // --- markup: pen, highlighter and eraser (SPEC section 5a) --------------

  /**
   * A stroke or an erase in progress: one pointer, from the page it started
   * on. Points are normalised on that page (clamped to it); the eraser
   * collects the marks it has touched.
   */
  const ink = useRef<{
    pointerId: number;
    pointerType: string;
    eraser: boolean;
    page: PageLayout;
    points: Point[];
    erased: Set<string>;
    /** Where the Pencil is about to be (drawn, never saved). */
    predicted: Point[];
    frame: number;
    /**
     * A shape being dragged out (points are its two corners): the Shapes
     * tool's, or "line" once a pen stroke held still has straightened.
     * After a held closed stroke, the shape it became (`held`: its points
     * are the shape's, and stay put).
     */
    shape: MarkupShape | HeldShape | null;
    held: boolean;
    /** A held rectangle or ellipse drawn at an angle: its turn (radians). */
    heldRotation: number;
    /**
     * A held shape as it snapped (page units), the centre it grows or
     * shrinks about, and how far the Pencil was from that centre then.
     */
    heldBase: Point[];
    heldCentre: Point;
    heldFrom: number;
    /** Where the pointer went down and how far it has gone (screen px). */
    start: Point;
    travel: number;
    /** Where the pen came to rest, and the timer that straightens it. */
    still: Point;
    timer: number;
  } | null>(null);

  /** Whether this pointer draws (or erases) with the current tool. */
  function inks(e: { pointerType: string; button: number }) {
    if (!isInkTool(latest.current.tool)) return false;
    if (e.pointerType === "mouse") return e.button === 0;
    return (
      e.pointerType === "pen" ||
      (e.pointerType === "touch" && latest.current.fingerDraw)
    );
  }

  /** A screen point (viewer px) as a normalised point on `page`. */
  function onPagePoint(page: PageLayout, p: Point): Point {
    const doc = screenToPage(currentTransform(), p);
    return { x: doc.x / DOC_WIDTH, y: (doc.y - page.top) / page.height };
  }

  /** Screen px per page unit (PDF point) on `page` at the current zoom. */
  function pxPerUnit(page: PageLayout) {
    return (DOC_WIDTH * applied.current.scale) / page.size.width;
  }

  function startInk(e: React.PointerEvent) {
    const p = local(e);
    const hit = hitPage(currentLayout(), screenToPage(currentTransform(), p));
    if (!hit) return;
    capture(e);
    hideSnapshot();
    cancelHold();
    tap.current = null;
    const shape =
      latest.current.tool === "shapes" ? latest.current.ink.shape : null;
    ink.current = {
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      eraser: latest.current.tool === "eraser",
      page: hit.page,
      points: shape ? [hit.at, hit.at] : [hit.at],
      erased: new Set(),
      predicted: [],
      frame: 0,
      shape,
      start: p,
      travel: 0,
      still: p,
      timer: 0,
      held: false,
      heldRotation: 0,
      heldBase: [],
      heldCentre: { x: 0, y: 0 },
      heldFrom: 0,
    };
    if (ink.current.eraser) eraseAt(p);
    else requestInkFrame();
    if (holds()) restartStill(p);
  }

  /** Whether the tool's strokes become shapes when held (pen and highlighter). */
  function holds() {
    const tool = latest.current.tool;
    return tool === "pen" || tool === "highlighter";
  }

  /** The pen came to rest at `p`: straighten the stroke if it stays there. */
  function restartStill(p: Point) {
    const stroke = ink.current;
    if (!stroke) return;
    window.clearTimeout(stroke.timer);
    stroke.still = p;
    stroke.timer = window.setTimeout(straighten, STRAIGHTEN_MS);
  }

  /**
   * GoodNotes style: a pen or highlighter stroke held still at its end
   * becomes the shape it looks like (engineer, 2026-10-07): a closed one a
   * circle, ellipse, rectangle, triangle or polygon (shapeRecognition.ts),
   * and anything else a straight line from where it started, whose end then
   * follows the Pencil in any direction until it lifts.
   */
  function straighten() {
    const stroke = ink.current;
    if (!stroke || stroke.shape || stroke.travel < MIN_SHAPE * 3) return;
    const size = stroke.page.size;
    const shape = recogniseShape(
      stroke.points.map((p) => ({ x: p.x * size.width, y: p.y * size.height })),
    );
    if (shape) {
      stroke.shape = shape.tool;
      stroke.held = true;
      stroke.heldRotation = shape.rotation ?? 0;
      stroke.points = shape.points.map((p) => ({
        x: p.x / size.width,
        y: p.y / size.height,
      }));
      // Dragging on from here scales it about its centre (engineer,
      // 2026-10-07): its corners' middle (a turned box turns about it too).
      const xs = shape.points.map((p) => p.x);
      const ys = shape.points.map((p) => p.y);
      const centre = {
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        y: (Math.min(...ys) + Math.max(...ys)) / 2,
      };
      const n = onPagePoint(stroke.page, stroke.still);
      const at = { x: n.x * size.width, y: n.y * size.height };
      stroke.heldBase = shape.points;
      stroke.heldCentre = centre;
      stroke.heldFrom = Math.max(
        1,
        Math.hypot(at.x - centre.x, at.y - centre.y),
      );
      stroke.predicted = [];
      requestInkFrame();
      return;
    }
    stroke.shape = "line";
    stroke.points = [stroke.points[0], stroke.points[stroke.points.length - 1]];
    stroke.predicted = [];
    requestInkFrame();
  }

  /**
   * A snapped shape follows the Pencil: further from its centre than when
   * it snapped, it grows; nearer, it shrinks (same proportions and angle).
   */
  function scaleHeld(stroke: NonNullable<typeof ink.current>, p: Point) {
    const size = stroke.page.size;
    const n = onPagePoint(stroke.page, p);
    const c = stroke.heldCentre;
    const k = Math.min(
      6,
      Math.max(
        0.15,
        Math.hypot(n.x * size.width - c.x, n.y * size.height - c.y) /
          stroke.heldFrom,
      ),
    );
    stroke.points = stroke.heldBase.map((q) => ({
      x: (c.x + (q.x - c.x) * k) / size.width,
      y: (c.y + (q.y - c.y) * k) / size.height,
    }));
  }

  function moveInk(e: React.PointerEvent) {
    const stroke = ink.current;
    if (!stroke) return;
    // Every sample the Pencil sent since the last event (up to 240 Hz).
    const samples = e.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const sample of samples.length ? samples : [e.nativeEvent]) {
      const p = local(sample);
      stroke.travel = Math.max(
        stroke.travel,
        Math.hypot(p.x - stroke.start.x, p.y - stroke.start.y),
      );
      if (stroke.eraser) eraseAt(p);
      else if (stroke.held) scaleHeld(stroke, p);
      else {
        const at = clampNormalised(onPagePoint(stroke.page, p));
        // A shape (or a straightened line) only moves its end.
        if (stroke.shape) stroke.points[1] = at;
        else stroke.points.push(at);
      }
    }
    if (stroke.eraser) return;
    // A pen stroke that moves on from where it rested keeps drawing.
    const last = local(e.nativeEvent);
    if (
      !stroke.shape &&
      holds() &&
      Math.hypot(last.x - stroke.still.x, last.y - stroke.still.y) > STILL_SLOP
    )
      restartStill(last);
    if (stroke.shape) {
      requestInkFrame();
      return;
    }
    // With the switch on (Settings), the iPad's estimate of the next few
    // positions extends the line toward the tip; never saved.
    stroke.predicted = latest.current.predict
      ? (e.nativeEvent.getPredictedEvents?.() ?? []).map((p) =>
          clampNormalised(onPagePoint(stroke.page, local(p))),
        )
      : [];
    requestInkFrame();
  }

  /** The newest filled shape under a screen point loses its fill. */
  function unfillAt(p: Point) {
    const hit = hitPage(currentLayout(), screenToPage(currentTransform(), p));
    if (!hit) return;
    const size = hit.page.size;
    const at = { x: hit.at.x * size.width, y: hit.at.y * size.height };
    const marks = latest.current.marks;
    for (let i = marks.length - 1; i >= 0; i--) {
      const mark = marks[i];
      if (mark.pageKey === hit.page.key && insideMark(mark, size, at))
        return latest.current.onUnfill(mark.id);
    }
  }

  /** Marks the eraser touches at a screen point. */
  function eraseAt(p: Point) {
    const stroke = ink.current;
    if (!stroke) return;
    const hit = hitPage(currentLayout(), screenToPage(currentTransform(), p));
    if (!hit) return;
    const size = hit.page.size;
    const at = { x: hit.at.x * size.width, y: hit.at.y * size.height };
    const reach = ERASER_REACH / pxPerUnit(hit.page);
    let added = false;
    for (const mark of latest.current.marks) {
      if (mark.pageKey !== hit.page.key || stroke.erased.has(mark.id)) continue;
      if (touchesMark(mark, size, at, reach)) {
        stroke.erased.add(mark.id);
        added = true;
      }
    }
    if (added) latest.current.onErase([...stroke.erased], false);
  }

  function requestInkFrame() {
    const stroke = ink.current;
    if (stroke && !stroke.frame) stroke.frame = requestAnimationFrame(drawInk);
  }

  /** Draws the stroke in progress (all of it: see-through ink can't overlap). */
  function drawInk() {
    const stroke = ink.current;
    const canvas = inkRef.current;
    if (!stroke || !canvas) return;
    stroke.frame = 0;
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = viewSize.current;
    const pw = Math.round(width * dpr);
    const ph = Math.round(height * dpr);
    canvas.hidden = false;
    if (canvas.width !== pw) canvas.width = pw;
    if (canvas.height !== ph) canvas.height = ph;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const t = currentTransform();
    const style = latest.current.ink;
    if (stroke.shape) {
      // Drawn in page units, the same shape as the saved mark will be.
      const size = stroke.page.size;
      const k = pxPerUnit(stroke.page);
      ctx.setTransform(
        dpr * k,
        0,
        0,
        dpr * k,
        dpr * t.x,
        dpr * (t.y + stroke.page.top * t.scale),
      );
      const flat = stroke.points.flatMap((p) => [p.x, p.y]);
      const [a, b] = toPagePoints(flat, size);
      const width = markWidth(style.weight, size);
      const drawing = stroke.held
        ? drawMark(
            {
              tool: stroke.shape,
              points: flat,
              weight: style.weight,
              rotation: stroke.heldRotation,
            },
            size,
          )
        : shapeDrawing(stroke.shape as MarkupShape, a, b, width);
      const path = new Path2D(drawing.d);
      // A highlighter's shape: see-through, never filled.
      const highlight = latest.current.tool === "highlighter";
      ctx.strokeStyle = ctx.fillStyle = style.colour;
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (drawing.closed && !highlight) {
        ctx.globalAlpha = SHAPE_FILL_OPACITY;
        ctx.fill(path);
      }
      ctx.globalAlpha = highlight ? style.opacity : 1;
      ctx.stroke(path);
      if (drawing.head) ctx.fill(new Path2D(drawing.head));
      return;
    }
    // Exactly the points the Pencil reported, joined by straight lines.
    const screen = [...stroke.points, ...stroke.predicted].map((n) =>
      pageToScreen(t, pagePointToDoc(stroke.page, n)),
    );
    ctx.globalAlpha = style.opacity;
    ctx.strokeStyle = style.colour;
    ctx.lineWidth =
      markWidth(style.weight, stroke.page.size) * pxPerUnit(stroke.page);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke(new Path2D(strokePath(screen)));
  }

  /**
   * Hides the live stroke and frees its canvas: a full-screen canvas left
   * over the document would be blended into every frame of a scroll.
   */
  function clearInk() {
    const canvas = inkRef.current;
    if (!canvas) return;
    canvas.hidden = true;
    canvas.width = 0;
    canvas.height = 0;
  }

  /** The stroke or erase ends: saved, or (cancelled) dropped. */
  function endInk(cancelled: boolean) {
    const stroke = ink.current;
    if (!stroke) return;
    ink.current = null;
    cancelAnimationFrame(stroke.frame);
    window.clearTimeout(stroke.timer);
    if (stroke.eraser) {
      latest.current.onErase(cancelled ? [] : [...stroke.erased], true);
      // A tap inside a filled shape (touching no line) takes its fill off.
      if (!cancelled && stroke.erased.size === 0 && stroke.travel < TAP_SLOP)
        unfillAt(stroke.start);
      return;
    }
    if (cancelled) return clearInk();
    // A tap (no stroke) on a mark picks it instead of leaving a dot.
    if (!stroke.held && stroke.travel < TAP_SLOP && tapMarkAt(stroke.start))
      return clearInk();
    if (stroke.shape) {
      // Too small to mean anything: dropped (a held shape is never small).
      if (!stroke.held && stroke.travel < MIN_SHAPE) return clearInk();
      void latest.current
        .onStroke(stroke.page, stroke.points, stroke.shape, stroke.heldRotation)
        .finally(() =>
          requestAnimationFrame(() => requestAnimationFrame(clearInk)),
        );
      return;
    }
    // Simplified in page units to within a fraction of a screen pixel.
    const size = stroke.page.size;
    const units = toPagePoints(
      stroke.points.flatMap((p) => [p.x, p.y]),
      size,
    );
    const kept = simplify(units, STROKE_TOLERANCE / pxPerUnit(stroke.page));
    const points = kept.map((p) => ({
      x: p.x / size.width,
      y: p.y / size.height,
    }));
    // The live stroke stays until the saved mark has drawn.
    void latest.current
      .onStroke(stroke.page, points, null)
      .finally(() =>
        requestAnimationFrame(() => requestAnimationFrame(clearInk)),
      );
  }

  // --- select (slice 2d) ----------------------------------------------------

  const select = useRef<{
    pointerId: number;
    pointerType: string;
    kind: "loop" | "move" | "handle";
    page: PageLayout;
    start: Point;
    travel: number;
    /** The loop drawn so far (screen px). */
    loop: Point[];
    handle: HandleId | null;
    last: SelectDrag | null;
    frame: number;
  } | null>(null);

  /** A page-unit point on `page` on the screen (viewer px). */
  function unitsToScreen(page: PageLayout, u: Point): Point {
    return pageToScreen(
      currentTransform(),
      pagePointToDoc(page, {
        x: u.x / page.size.width,
        y: u.y / page.size.height,
      }),
    );
  }

  /** The selected marks and their page, if any are still there. */
  function selected() {
    const sel = latest.current.selection;
    const page = sel && pagesRef.current.get(sel.pageKey);
    if (!sel || !page) return null;
    const marks = latest.current.marks.filter(
      (m) => m.pageKey === sel.pageKey && sel.ids.includes(m.id),
    );
    return marks.length ? { page, marks } : null;
  }

  /** The mark under `p` (viewer px) on `page`, if any. */
  function markAt(page: PageLayout, p: Point) {
    const size = page.size;
    const n = onPagePoint(page, p);
    return pickMark(
      latest.current.marks.filter((m) => m.pageKey === page.key),
      size,
      { x: n.x * size.width, y: n.y * size.height },
      ERASER_REACH / pxPerUnit(page),
    );
  }

  /** Whether a tap on a mark picks it (no tool, or a drawing tool). */
  function tapsSelect() {
    const tool = latest.current.tool;
    return (
      tool === null ||
      tool === "pen" ||
      tool === "highlighter" ||
      tool === "shapes"
    );
  }

  /**
   * A tap at `p` (viewer px) with no tool or a drawing tool: if it lands on
   * a mark, that mark is picked (Select comes on) and true is returned.
   */
  function tapMarkAt(p: Point): boolean {
    if (!tapsSelect()) return false;
    const hit = hitPage(currentLayout(), screenToPage(currentTransform(), p));
    const mark = hit && markAt(hit.page, p);
    if (!hit || !mark) return false;
    latest.current.onTapMark({ pageKey: hit.page.key, ids: [mark.id] }, hit);
    return true;
  }

  /** A tap at `p` (viewer px): the mark under it, else nothing selected. */
  function selectAt(p: Point) {
    const hit = hitPage(currentLayout(), screenToPage(currentTransform(), p));
    const mark = hit && markAt(hit.page, p);
    latest.current.onSelectMarks(
      hit && mark ? { pageKey: hit.page.key, ids: [mark.id] } : null,
    );
  }

  /**
   * A press with Select on: on a single shape's handle it resizes; inside
   * the selection's box it moves it (finger too); otherwise the Pencil or
   * mouse (or a finger with Draw with finger) draws a loop, or taps to pick.
   * A plain finger elsewhere scrolls (its tap picks, in onPointerUp).
   */
  function startSelect(e: React.PointerEvent): boolean {
    const p = local(e);
    const begin = (
      kind: "loop" | "move" | "handle",
      page: PageLayout,
      handle: HandleId | null = null,
    ) => {
      if (e.pointerType === "mouse") e.preventDefault();
      capture(e);
      hideSnapshot();
      cancelHold();
      tap.current = null;
      select.current = {
        pointerId: e.pointerId,
        pointerType: e.pointerType,
        kind,
        page,
        start: p,
        travel: 0,
        loop: [p],
        handle,
        last: null,
        frame: 0,
      };
      return true;
    };
    const current = selected();
    if (current) {
      const { page, marks } = current;
      // The rotate handle, above the selection.
      const turn = rotateHandle(
        marks,
        page.size,
        ROTATE_OFFSET_PX / pxPerUnit(page),
      );
      if (turn) {
        const at = unitsToScreen(page, turn);
        if (Math.hypot(at.x - p.x, at.y - p.y) <= HANDLE_REACH)
          return begin("handle", page, "rotate");
      }
      if (marks.length === 1)
        for (const h of shapeHandles(marks[0], page.size)) {
          const at = unitsToScreen(page, h.at);
          if (Math.hypot(at.x - p.x, at.y - p.y) <= HANDLE_REACH)
            return begin("handle", page, h.id);
        }
      const b = selectionBounds(marks, page.size);
      const tl = unitsToScreen(page, b);
      const br = unitsToScreen(page, {
        x: b.x + b.width,
        y: b.y + b.height,
      });
      if (
        p.x >= tl.x - SELECT_MARGIN &&
        p.x <= br.x + SELECT_MARGIN &&
        p.y >= tl.y - SELECT_MARGIN &&
        p.y <= br.y + SELECT_MARGIN
      )
        return begin("move", page);
    }
    if (e.pointerType === "touch" && !latest.current.fingerDraw) return false;
    const hit = hitPage(currentLayout(), screenToPage(currentTransform(), p));
    if (!hit) return false;
    return begin("loop", hit.page);
  }

  function moveSelect(e: React.PointerEvent) {
    const s = select.current;
    if (!s) return;
    const p = local(e);
    s.travel = Math.max(s.travel, Math.hypot(p.x - s.start.x, p.y - s.start.y));
    if (s.kind === "loop") {
      s.loop.push(p);
      if (!s.frame) s.frame = requestAnimationFrame(drawLoop);
      return;
    }
    if (s.travel < TAP_SLOP) return;
    if (s.kind === "handle" && s.handle) {
      s.last = {
        kind: "handle",
        handle: s.handle,
        to: clampNormalised(onPagePoint(s.page, p)),
        from: onPagePoint(s.page, s.start),
      };
    } else {
      const current = selected();
      if (!current) return;
      const a = onPagePoint(s.page, s.start);
      const b = onPagePoint(s.page, p);
      s.last = {
        kind: "move",
        ...clampMove(
          selectionBounds(current.marks, s.page.size),
          s.page.size,
          b.x - a.x,
          b.y - a.y,
        ),
      };
    }
    latest.current.onSelectDrag(s.last, false);
  }

  function endSelect(cancelled: boolean) {
    const s = select.current;
    if (!s) return;
    select.current = null;
    cancelAnimationFrame(s.frame);
    if (s.kind === "loop") {
      clearInk();
      if (cancelled) return;
      if (s.travel < TAP_SLOP) return selectAt(s.start);
      const size = s.page.size;
      const loop = s.loop.map((q) => {
        const n = onPagePoint(s.page, q);
        return { x: n.x * size.width, y: n.y * size.height };
      });
      const ids = marksInLoop(
        latest.current.marks.filter((m) => m.pageKey === s.page.key),
        size,
        loop,
      ).map((m) => m.id);
      latest.current.onSelectMarks(
        ids.length ? { pageKey: s.page.key, ids } : null,
      );
      return;
    }
    latest.current.onSelectDrag(cancelled ? null : s.last, true);
    // A tap inside the selection picks the mark under it (if any); on the
    // only one picked, it's tapped again (a callout opens for typing).
    if (!s.last && s.kind === "move" && !cancelled) {
      const mark = markAt(s.page, s.start);
      const sel = latest.current.selection;
      if (mark && sel?.ids.length === 1 && sel.ids[0] === mark.id)
        latest.current.onSelectTapAgain(mark.id);
      else if (mark)
        latest.current.onSelectMarks({ pageKey: s.page.key, ids: [mark.id] });
    }
  }

  /** The loop being drawn: a thin dashed line (screen px). */
  function drawLoop() {
    const s = select.current;
    const canvas = inkRef.current;
    if (!s || !canvas) return;
    s.frame = 0;
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = viewSize.current;
    const pw = Math.round(width * dpr);
    const ph = Math.round(height * dpr);
    canvas.hidden = false;
    if (canvas.width !== pw) canvas.width = pw;
    if (canvas.height !== ph) canvas.height = ph;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#3b3b3b";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    s.loop.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Runs before pins and the notes box see the touch. A touch that lands
  // while the document is scrolling only stops it: on a pin or the box it
  // is swallowed; on the drawing it never places a pin.
  function onPointerDownCapture(e: React.PointerEvent) {
    // Select takes the pointer before the drawing's own gestures (not on
    // pins, the notes box or the selection's bar).
    if (
      latest.current.tool === "select" &&
      !select.current &&
      !(e.pointerType === "touch" && !e.isPrimary) &&
      !(e.pointerType === "mouse" && e.button !== 0) &&
      !(e.target as Element).closest(
        ".viewer-pin, .arrow-handle, .observation-box, .select-bar",
      ) &&
      startSelect(e)
    ) {
      e.stopPropagation();
      return;
    }
    // Drawing and erasing take the pointer before pins and the notes box.
    if (inks(e)) {
      e.stopPropagation();
      // One stroke at a time; a second finger is a pinch.
      if (!ink.current && !(e.pointerType === "touch" && !e.isPrimary))
        startInk(e);
      return;
    }
    if (msSince(lastScroll.current) > SCROLL_STOP_MS) return;
    // The second tap of a double-tap is never a scroll stop: the first one
    // can make the view move (a panel opening resizes it).
    if (nearLastTap(local(e), e.timeStamp)) return;
    if (e.pointerType === "mouse") return;
    stopTouch.current = e.pointerId;
    if (
      (e.target as Element).closest(
        ".viewer-pin, .arrow-handle, .observation-box",
      )
    )
      e.stopPropagation();
  }

  function onPointerDown(e: React.PointerEvent) {
    // A first finger (or the mouse) means nothing else is down: forget any
    // pointer whose "up" was lost, or every later tap would look like part
    // of a two-finger gesture and Add pin would stop working.
    if (e.isPrimary) pointers.current.clear();
    // A touch already hid it (touchstart comes first).
    if (e.pointerType !== "touch") hideSnapshot();
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // Stop a mouse drag from selecting text around the viewer.
    if (e.pointerType === "mouse") {
      e.preventDefault();
      capture(e);
    }
    const p = local(e);
    pointers.current.set(e.pointerId, { ...p, type: e.pointerType });
    tap.current =
      pointers.current.size === 1
        ? { id: e.pointerId, start: p, time: e.timeStamp }
        : null;
    cancelHold();
    if (
      tap.current &&
      !latest.current.addPinMode &&
      stopTouch.current !== e.pointerId
    ) {
      if (latest.current.tool === "pin") {
        const second = nearLastTap(p, e.timeStamp);
        if (second) {
          latest.current.onSecondPress({
            hit: hitPage(currentLayout(), screenToPage(currentTransform(), p)),
          });
        }
        startHold(e.pointerId, p, second ? "observation" : "instruction");
      } else if (latest.current.tool === "text") {
        // Like a pin (any finger or the Pencil): hold, then drag a leader.
        startHold(e.pointerId, p, "text");
      }
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (ink.current?.pointerId === e.pointerId) return moveInk(e);
    if (select.current?.pointerId === e.pointerId) return moveSelect(e);
    const h = hold.current;
    if (h?.pointerId === e.pointerId) {
      if (h.held) return holdMove(local(e));
      const q = local(e);
      if (Math.hypot(q.x - h.start.x, q.y - h.start.y) >= TAP_SLOP)
        cancelHold();
    }
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const p = local(e);
    pointers.current.set(e.pointerId, { ...p, type: prev.type });
    const pending = tap.current;
    if (pending?.id === e.pointerId) {
      if (Math.hypot(p.x - pending.start.x, p.y - pending.start.y) < TAP_SLOP)
        return;
      tap.current = null;
      // Touch scrolling is the browser's; only a mouse drag pans here.
      if (prev.type === "mouse") {
        setTransform(
          panBy(
            currentTransform(),
            p.x - pending.start.x,
            p.y - pending.start.y,
          ),
        );
      }
      return;
    }
    if (prev.type === "mouse" && !tap.current) {
      setTransform(panBy(currentTransform(), p.x - prev.x, p.y - prev.y));
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    if (select.current?.pointerId === e.pointerId) return endSelect(false);
    if (ink.current?.pointerId === e.pointerId) {
      // A cancelled pointer still keeps what was drawn (Safari can cancel
      // one mid-stroke); a pinch drops it before this (touchstart).
      return endInk(false);
    }
    const h = hold.current;
    if (h?.pointerId === e.pointerId) {
      if (!h.held) {
        cancelHold();
      } else {
        pointers.current.delete(e.pointerId);
        tap.current = null;
        if (e.type === "pointerup") holdEnd(local(e));
        // A cancelled touch carries on: Safari may cancel the pointer
        // while touch events (which hold the scroll off) keep coming.
        else if (e.pointerType !== "touch") cancelHold();
        return;
      }
    }
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    const pending = tap.current;
    tap.current = null;
    const stoppedScroll = stopTouch.current === e.pointerId;
    if (stoppedScroll) stopTouch.current = null;
    const tapped =
      e.type === "pointerup" &&
      !stoppedScroll &&
      pending?.id === e.pointerId &&
      e.timeStamp - pending.time < TAP_MS;
    if (!tapped) return;
    const second = isSecondTap(local(e), e.timeStamp);
    const hit = hitPage(
      currentLayout(),
      screenToPage(currentTransform(), local(e)),
    );
    if (latest.current.addPinMode) {
      if (hit) latest.current.onPlacePin(hit.page, hit.at);
    } else if (second && latest.current.tool === "pin") {
      latest.current.onDoubleTap({ hit });
    } else if (latest.current.tool === "select") {
      // A finger's tap with Select on picks the mark under it.
      latest.current.onTapDrawing(hit);
      selectAt(local(e));
    } else if (!tapMarkAt(local(e))) {
      // A tap on the drawing itself (pins, arrow tips and the notes box
      // handle their own taps; a mark is picked above).
      latest.current.onTapDrawing(hit);
    }
  }

  /** Whether a press here and now would be the second of a double-tap. */
  function nearLastTap(at: Point, time: number) {
    const prev = lastTap.current;
    return (
      prev !== null &&
      time - prev.time < DOUBLE_TAP_MS &&
      Math.hypot(at.x - prev.at.x, at.y - prev.at.y) < DOUBLE_TAP_SLOP
    );
  }

  /** Records a tap; true when it is the second of a double-tap. */
  function isSecondTap(at: Point, time: number, onPin = false) {
    const second = nearLastTap(at, time);
    // A third tap starts a new pair.
    lastTap.current = second ? null : { at, time, onPin };
    return second;
  }

  // --- hold: an arrowhead, then drag the pin out ---------------------------

  /** A point on the screen, in the scrolled content (where the layer is). */
  function toContent(p: Point): Point {
    const c = containerRef.current!;
    return { x: p.x + c.scrollLeft, y: p.y + c.scrollTop };
  }

  function holdLine(from: Point, to: Point) {
    const line = holdRef.current?.querySelector("line");
    if (!line) return;
    line.setAttribute("x1", String(from.x));
    line.setAttribute("y1", String(from.y));
    line.setAttribute("x2", String(to.x));
    line.setAttribute("y2", String(to.y));
  }

  /**
   * Puts the hold's pin (or callout box) at `c`, in content pixels; a box
   * hangs from its corner nearest the arrowhead (`left`, `up`).
   */
  function holdPin(c: Point, left: boolean, up: boolean) {
    const layer = holdRef.current;
    if (!layer) return;
    layer.style.setProperty("--pin-x", `${c.x}px`);
    layer.style.setProperty("--pin-y", `${c.y}px`);
    layer.dataset.left = String(left);
    layer.dataset.up = String(up);
  }

  /** Shows the hold layer (nothing is touched until the ring is due). */
  function showHold(state: "pending" | "held" | null) {
    const layer = holdRef.current;
    const h = hold.current;
    if (!layer) return;
    if (!state || !h) {
      delete layer.dataset.state;
      return;
    }
    const c = toContent(h.origin);
    layer.style.setProperty("--hold-x", `${c.x}px`);
    layer.style.setProperty("--hold-y", `${c.y}px`);
    holdPin(c, false, false);
    layer.dataset.kind = h.kind;
    // A callout's hold shows in the Text tool's colour.
    if (h.kind === "text")
      layer.style.setProperty("--hold-colour", latest.current.ink.colour);
    else layer.style.removeProperty("--hold-colour");
    if (state === "pending") holdLine(c, c);
    layer.dataset.state = state;
  }

  function beginHold(
    pointerId: number,
    start: Point,
    origin: Point,
    page: PageLayout,
    at: Point,
    kind: "instruction" | "observation" | "text",
    pinId: string | null,
    headFirst: boolean,
  ) {
    hold.current = {
      pointerId,
      start,
      origin,
      page,
      at,
      kind,
      pinId,
      headFirst,
      timer: window.setTimeout(fireHold, HOLD_MS),
      ringTimer: window.setTimeout(() => showHold("pending"), RING_DELAY_MS),
      held: false,
      end: null,
    };
  }

  /**
   * A press on the drawing: a pin (an observation after a tap) or, with
   * the Text tool, a callout.
   */
  function startHold(
    pointerId: number,
    start: Point,
    kind: "instruction" | "observation" | "text",
  ) {
    const hit = hitPage(
      currentLayout(),
      screenToPage(currentTransform(), start),
    );
    if (!hit) return;
    beginHold(pointerId, start, start, hit.page, hit.at, kind, null, true);
  }

  /**
   * The second press of a double-tap landed on a pin: usually the one the
   * first tap just placed (`headFirst`: it moves to where the drag ends),
   * else one that was already there (it stays; its arrow follows the drag).
   */
  function startPinHold(
    pointerId: number,
    pinId: string,
    start: Point,
    headFirst: boolean,
  ) {
    const pin = latest.current.pins.find((p) => p.id === pinId);
    const page = pin && pagesRef.current.get(pin.pageKey);
    if (!pin || !page) return;
    const at = { x: pin.x, y: pin.y };
    const origin = pageToScreen(currentTransform(), pagePointToDoc(page, at));
    beginHold(
      pointerId,
      start,
      origin,
      page,
      at,
      "observation",
      pinId,
      headFirst,
    );
  }

  function fireHold() {
    const h = hold.current;
    if (!h) return;
    // Still pressed and unmoved (a scroll, drag or second finger cancels it).
    const drag = dragging.current;
    const pressed = h.pinId
      ? drag?.pointerId === h.pointerId && !drag.moved
      : tap.current?.id === h.pointerId;
    if (!pressed) return cancelHold();
    h.held = true;
    tap.current = null;
    lastTap.current = null;
    showHold("held");
  }

  function cancelHold() {
    const h = hold.current;
    if (!h) return;
    window.clearTimeout(h.timer);
    window.clearTimeout(h.ringTimer);
    hold.current = null;
    showHold(null);
  }

  function holdMove(p: Point) {
    const h = hold.current;
    if (!h?.held) return;
    if (Math.hypot(p.x - h.start.x, p.y - h.start.y) < ARROW_MIN) {
      h.end = null;
    } else {
      // The drag stays on the press's page.
      const doc = screenToPage(currentTransform(), p);
      h.end = clampNormalised({
        x: doc.x / DOC_WIDTH,
        y: (doc.y - h.page.top) / h.page.height,
      });
    }
    const press = toContent(h.origin);
    const end = h.end
      ? toContent(
          pageToScreen(currentTransform(), pagePointToDoc(h.page, h.end)),
        )
      : press;
    if (h.headFirst) {
      // The arrowhead stays at the press; the pin follows the finger.
      holdLine(end, press);
      holdPin(end, end.x < press.x, end.y < press.y);
    } else {
      holdLine(press, end);
    }
  }

  function holdEnd(p: Point) {
    const h = hold.current;
    if (!h?.held) return;
    holdMove(p);
    cancelHold();
    // Dragged: the box where it lifted, its leader to the press. A pin's
    // screen decides which end it goes (it knows which pin is new).
    if (h.kind === "text") {
      if (h.end) latest.current.onPlaceText(h.page, h.end, h.at);
      else latest.current.onPlaceText(h.page, h.at, null);
    } else {
      latest.current.onHoldPlace(h.page, h.at, h.end, h.kind, h.pinId);
    }
  }

  // Native scrolling, touch pinch, Pencil and wheel zoom.
  useEffect(() => {
    const container = containerRef.current!;
    const onScroll = () => {
      lastScroll.current = performance.now();
      noteScroll();
      if (hold.current && !hold.current.held) cancelHold();
      readScroll();
    };

    const fingers = (list: ArrayLike<TouchLike>) =>
      Array.from(list).filter((t) => t.touchType !== "stylus");
    const hasStylus = (list: ArrayLike<TouchLike>) =>
      Array.from(list).some((t) => t.touchType === "stylus");
    const pinchOf = (pair: TouchLike[], origin: Point) => {
      const [a, b] = pair.map((t) => ({
        x: t.clientX - origin.x,
        y: t.clientY - origin.y,
      }));
      return {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      };
    };
    // Pinch (as pdf.js does it): while the fingers are down the content is
    // only scaled as a picture with a CSS transform, so nothing is laid out
    // or scrolled mid-gesture (Safari's async scrolling would fight it).
    // When the fingers lift, the new zoom is laid out once.
    const startPinch = (list: TouchLike[]) => {
      // Measured once: the viewer doesn't move during a pinch.
      const box = container.getBoundingClientRect();
      const origin = { x: box.left, y: box.top };
      const start = pinchOf(list, origin);
      const base = currentTransform();
      pinch.current = {
        startDist: start.dist,
        startMid: start.mid,
        origin,
        base,
        target: base,
        frame: 0,
      };
      // Nothing else on the main thread mid-pinch: no pending sharpen, and
      // no page drawing in progress (it redraws after the fingers lift).
      window.clearTimeout(settleTimer.current);
      for (const cancel of renderCancels.current) cancel();
      // The pinch moves a screen-sized snapshot; the document stays still.
      captureSnapshot(base);
    };
    const endPinch = () => {
      const p = pinch.current;
      if (!p) return;
      pinch.current = null;
      cancelAnimationFrame(p.frame);
      // Laid out at the new zoom under the snapshot, which shows it already.
      setTransform(p.target);
      releaseSnapshotWhenReady();
    };
    // Two fingers tapped together (not a pinch or scroll): two of these in
    // quick succession undo.
    let twoTap: {
      start: number;
      at: { x: number; y: number }[];
      moved: boolean;
      most: number;
    } | null = null;
    let lastTwoTap = -Infinity;
    const onTouchStart = (e: TouchEvent) => {
      const list = fingers(e.touches);
      if (list.length === 2 && !twoTap)
        twoTap = {
          start: e.timeStamp,
          at: list.map((t) => ({ x: t.clientX, y: t.clientY })),
          moved: false,
          most: 2,
        };
      else if (twoTap) twoTap.most = Math.max(twoTap.most, list.length);
      // A second finger while drawing with one: a pinch, not a stroke.
      if (list.length >= 2 && ink.current?.pointerType === "touch")
        endInk(true);
      if (list.length >= 2 && select.current?.pointerType === "touch")
        endSelect(true);
      if (list.length < 2) {
        // A new touch works on the real document (a scroll, a tap): show it.
        if (!pinch.current) hideSnapshot();
        return;
      }
      // Two fingers: our pinch, not the browser's scroll or zoom.
      e.preventDefault();
      tap.current = null;
      cancelHold();
      if (!pinch.current) startPinch(list);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (twoTap && !twoTap.moved) {
        const tap = twoTap;
        tap.moved = fingers(e.touches).some((t, i) => {
          const from = tap.at[i];
          return (
            !!from &&
            Math.hypot(t.clientX - from.x, t.clientY - from.y) > TWO_TAP_SLOP
          );
        });
      }
      // A finger dragging a callout moves it, not the page.
      if ((e.target as Element | null)?.closest?.(".callout-hit")) {
        if (e.cancelable) e.preventDefault();
        return;
      }
      // Drawing, erasing or selecting owns the touch: the document stays still.
      if (ink.current || select.current) {
        if (e.cancelable) e.preventDefault();
        return;
      }
      // After a hold the viewer owns the touch: the arrow follows it and
      // the document stays still.
      if (hold.current?.held) {
        if (e.cancelable) e.preventDefault();
        const t = e.touches[0];
        if (t) holdMove(local(t));
        return;
      }
      // Pencil never scrolls (iPad marks it "stylus"; elsewhere a pen
      // pointer is down).
      if (hasStylus(e.touches) || penDown()) {
        if (e.cancelable) e.preventDefault();
        return;
      }
      const list = fingers(e.touches);
      const p = pinch.current;
      if (list.length < 2 || !p) return;
      if (e.cancelable) e.preventDefault();
      const now = pinchOf(list, p.origin);
      // Always from the start of the gesture, so nothing accumulates.
      p.target = panBy(
        zoomAt(p.base, now.dist / p.startDist, p.startMid, zoomLimits()),
        now.mid.x - p.startMid.x,
        now.mid.y - p.startMid.y,
      );
      // At most one style change per frame, however fast touches arrive.
      if (!p.frame) {
        p.frame = requestAnimationFrame(() => {
          p.frame = 0;
          snapshot.current?.move(p.target);
        });
      }
    };
    /** A pointer lifted anywhere: stop tracking it (the viewer may have missed it). */
    const forgetPointer = (e: PointerEvent) => {
      pointers.current.delete(e.pointerId);
      if (tap.current?.id === e.pointerId) tap.current = null;
    };
    const onTouchEnd = (e: TouchEvent) => {
      // A hold whose pointer was cancelled ends with its touch.
      const t = e.changedTouches?.[0];
      if (hold.current?.held && e.touches.length === 0 && t) {
        if (e.type === "touchend") holdEnd(local(t));
        else cancelHold();
      }
      const list = fingers(e.touches);
      if (twoTap && list.length === 0) {
        const tap = twoTap;
        twoTap = null;
        if (
          e.type === "touchend" &&
          !tap.moved &&
          tap.most === 2 &&
          e.timeStamp - tap.start < TWO_TAP_MS
        ) {
          if (e.timeStamp - lastTwoTap < TWO_TAP_GAP) {
            lastTwoTap = -Infinity;
            latest.current.onUndoGesture();
          } else lastTwoTap = e.timeStamp;
        } else lastTwoTap = -Infinity;
      }
      if (!pinch.current) return;
      endPinch();
      // Still two fingers down (a third lifted): carry on from here.
      if (list.length >= 2) startPinch(list);
    };

    // Plain wheel and trackpad scrolling are native; pinch / ctrl+wheel zooms.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      hideSnapshot();
      setTransform(
        zoomAt(
          currentTransform(),
          Math.exp(-e.deltaY * 0.01),
          local(e),
          zoomLimits(),
        ),
      );
    };
    const stopGesture = (e: Event) => e.preventDefault();
    container.addEventListener("scroll", onScroll, { passive: true });
    container.addEventListener("touchstart", onTouchStart, { passive: false });
    container.addEventListener("touchmove", onTouchMove, { passive: false });
    // Ends are heard on the whole document: a touch whose target was removed
    // or redrawn mid-gesture never bubbles its end up to the viewer.
    document.addEventListener("touchend", onTouchEnd);
    document.addEventListener("touchcancel", onTouchEnd);
    window.addEventListener("pointerup", forgetPointer);
    window.addEventListener("pointercancel", forgetPointer);
    container.addEventListener("wheel", onWheel, { passive: false });
    document.addEventListener("gesturestart", stopGesture);
    document.addEventListener("gesturechange", stopGesture);
    return () => {
      container.removeEventListener("scroll", onScroll);
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchEnd);
      window.removeEventListener("pointerup", forgetPointer);
      window.removeEventListener("pointercancel", forgetPointer);
      container.removeEventListener("wheel", onWheel);
      document.removeEventListener("gesturestart", stopGesture);
      document.removeEventListener("gesturechange", stopGesture);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- pins ---------------------------------------------------------------

  function pinPosition(pin: DocPin, p: Point): Point {
    const page = pagesRef.current.get(pin.pageKey)!;
    const doc = screenToPage(currentTransform(), p);
    return clampNormalised({
      x: doc.x / DOC_WIDTH,
      y: (doc.y - page.top) / page.height,
    });
  }

  function onPinPointerDown(
    e: React.PointerEvent,
    id: string,
    arrowId: string | null = null,
  ) {
    e.stopPropagation();
    capture(e);
    dragging.current = {
      id,
      arrowId,
      pointerId: e.pointerId,
      start: local(e),
      moved: false,
      last: null,
    };
    // Pressed again just after a tap: holding makes it an observation with
    // an arrow (moving first still drags the pin).
    if (
      !arrowId &&
      latest.current.tool === "pin" &&
      nearLastTap(local(e), e.timeStamp)
    ) {
      const firstOnPin = lastTap.current?.onPin ?? false;
      latest.current.onSecondPress({ pinId: id });
      startPinHold(e.pointerId, id, local(e), !firstOnPin);
    }
  }

  function onPinPointerMove(e: React.PointerEvent, pin: DocPin) {
    const h = hold.current;
    if (h?.pointerId === e.pointerId) {
      if (h.held) return holdMove(local(e));
      const q = local(e);
      if (Math.hypot(q.x - h.start.x, q.y - h.start.y) >= TAP_SLOP)
        cancelHold();
    }
    const drag = dragging.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const p = local(e);
    if (
      !drag.moved &&
      Math.hypot(p.x - drag.start.x, p.y - drag.start.y) < TAP_SLOP
    )
      return;
    drag.moved = true;
    drag.last = pinPosition(pin, p);
    if (drag.arrowId)
      latest.current.onMoveArrow(drag.id, drag.arrowId, drag.last);
    else latest.current.onMovePin(drag.id, drag.last);
  }

  function onPinPointerUp(e: React.PointerEvent) {
    const h = hold.current;
    if (h?.pointerId === e.pointerId) {
      if (h.held) {
        dragging.current = null;
        if (e.type === "pointerup") holdEnd(local(e));
        else cancelHold();
        return;
      }
      cancelHold();
    }
    const drag = dragging.current;
    if (drag?.pointerId !== e.pointerId) return;
    dragging.current = null;
    if (e.type !== "pointerup") return;
    if (drag.arrowId) {
      if (drag.moved && drag.last)
        latest.current.onMoveArrowEnd(drag.id, drag.arrowId, drag.last);
      else if (!drag.moved) latest.current.onSelectArrow(drag.id, drag.arrowId);
      return;
    }
    if (drag.moved && drag.last) {
      latest.current.onMovePinEnd(drag.id, drag.last);
    } else if (!drag.moved) {
      if (
        latest.current.tool === "pin" &&
        isSecondTap(local(e), e.timeStamp, true)
      )
        latest.current.onDoubleTap({ pinId: drag.id });
      else latest.current.onSelectPin(drag.id);
    }
  }

  // Each page's overlay converts pointer positions relative to that page.
  const coordFns = useMemo(
    () =>
      new Map(
        layout.pages.map((page) => [
          page.key,
          (clientX: number, clientY: number): Point => {
            const doc = screenToPage(
              currentTransform(),
              local({ clientX, clientY }),
            );
            return {
              x: doc.x / DOC_WIDTH,
              y: (doc.y - page.top) / page.height,
            };
          },
        ]),
      ),
    // local() and currentTransform() only read refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layout],
  );

  const onRendered = useCallback((key: string) => {
    setRenderedKeys((old) => (old.has(key) ? old : new Set(old).add(key)));
  }, []);

  const ready = currentPageKey !== null && renderedKeys.has(currentPageKey);

  return (
    <>
      <div
        ref={containerRef}
        className={`viewer${addPinMode ? " viewer-add-pin" : ""}${isInkTool(props.tool) ? " viewer-inking" : ""}`}
        data-testid="drawing-viewer"
        data-ready={ready}
        onPointerDownCapture={onPointerDownCapture}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div ref={sizerRef} className="doc-sizer">
          <div
            ref={stageRef}
            className="doc-stage"
            style={{ width: DOC_WIDTH, height: layout.height }}
          >
            {layout.pages.map((page) => (
              <DocPage
                key={page.key}
                page={page}
                doc={docs.get(page.pdfDrawingId)}
                active={activeKeys.has(page.key)}
                view={settled}
                moving={moving}
                overlay={
                  activeKeys.has(page.key)
                    ? props.renderPageOverlay(page)
                    : null
                }
                clientToNormalised={coordFns.get(page.key)!}
                onRendered={onRendered}
                registerRender={registerRender}
              />
            ))}
          </div>
          <div ref={holdRef} className="hold-layer" aria-hidden="true">
            <svg className="hold-arrow">
              <defs>
                <marker
                  id="hold-arrow-head"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="4"
                  markerHeight="4"
                  orient="auto"
                >
                  <path d="M0 0L10 5L0 10z" />
                </marker>
              </defs>
              <line markerEnd="url(#hold-arrow-head)" />
            </svg>
            <div className="hold-ring" />
            <div className="hold-pin" />
          </div>
          <div className="viewer-pins">
            {pins.map((pin) => (
              <button
                key={pin.id}
                type="button"
                className={[
                  "viewer-pin",
                  pin.kind === "observation" ? "viewer-pin-observation" : "",
                  pin.selected ? "viewer-pin-selected" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                data-testid="viewer-pin"
                data-kind={pin.kind}
                data-letter={pin.letter}
                data-page={pin.pageKey}
                data-x={pin.x.toFixed(4)}
                data-y={pin.y.toFixed(4)}
                aria-label={`${kindName(pin.kind)} pin ${pin.letter}`}
                ref={(el) => {
                  if (el) pinEls.current.set(pin.id, el);
                  else pinEls.current.delete(pin.id);
                }}
                onPointerDown={(e) => onPinPointerDown(e, pin.id)}
                onPointerMove={(e) => onPinPointerMove(e, pin)}
                onPointerUp={onPinPointerUp}
                onPointerCancel={onPinPointerUp}
              >
                {pin.letter}
              </button>
            ))}
            {pins
              .filter((pin) => pin.selected)
              .flatMap((pin) =>
                pin.arrows.map((arrow, i) => (
                  <button
                    key={`${pin.id}:${arrow.id}`}
                    type="button"
                    className={[
                      "arrow-handle",
                      arrow.id === pin.selectedArrowId
                        ? "arrow-handle-selected"
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    data-testid="arrow-handle"
                    data-x={arrow.x.toFixed(4)}
                    data-y={arrow.y.toFixed(4)}
                    aria-label={`Arrow ${i + 1} of ${kindName(pin.kind).toLowerCase()} ${pin.letter}`}
                    aria-pressed={arrow.id === pin.selectedArrowId}
                    ref={(el) => {
                      const key = `${pin.id}:${arrow.id}`;
                      if (el) pinEls.current.set(key, el);
                      else pinEls.current.delete(key);
                    }}
                    onPointerDown={(e) => onPinPointerDown(e, pin.id, arrow.id)}
                    onPointerMove={(e) => onPinPointerMove(e, pin)}
                    onPointerUp={onPinPointerUp}
                    onPointerCancel={onPinPointerUp}
                  />
                )),
              )}
          </div>
        </div>
      </div>
      <canvas ref={inkRef} className="viewer-ink" aria-hidden="true" hidden />
      {/* The pinch snapshot, over the viewer (pinchSnapshot.ts). */}
      <div
        ref={snapshotHostRef}
        className="viewer-snapshot"
        data-testid="pinch-snapshot"
        aria-hidden="true"
      />
      {props.diagnostics && <DiagnosticsPanel viewerRef={containerRef} />}
    </>
  );
}
