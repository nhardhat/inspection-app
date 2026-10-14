/**
 * Drawing viewer diagnostics (step 10): what each page on screen was drawn
 * at, against what it wanted, plus render errors, scroll smoothness and
 * PDF open times, for the panel the engineer can screenshot or copy from
 * the iPad (there is no Web Inspector without a Mac). A plain module the
 * viewer writes to and the panel reads every half second; it holds only
 * numbers and page numbers, never drawing names.
 */

/** One render of a page: device pixels per PDF point, and what it cost. */
export interface RenderStat {
  scale: number;
  /** The scale the view asked for. */
  wanted: number;
  /** Why it got less: the base image's pixel cap, or the sharp budget. */
  limit: "cap" | "budget" | null;
  /** Canvas pixels. */
  pixels: number;
  /** How long pdf.js took (until now, while drawing). */
  ms: number;
  /** "saved": shown from its saved image (no PDF drawing). */
  state: "drawing" | "done" | "cancelled" | "failed" | "saved";
  /** When it started (performance.now()). */
  started: number;
  kind: Activity;
}

export interface PageStat {
  drawingId: string;
  /** Page number through the document. */
  number: number;
  widthPt: number;
  heightPt: number;
  base: RenderStat | null;
  /** The sharp render of the visible part; null when the base is enough. */
  sharp: RenderStat | null;
}

export interface ViewStat {
  /** Zoom as a multiple of fit width. */
  zoom: number;
  dpr: number;
  /** Pages on screen, in order. */
  visibleKeys: string[];
}

export interface ScrollStat {
  seconds: number;
  fps: number;
  worstMs: number;
  /** Share of its frames during which a page was being drawn (0..1). */
  drawingShare: number;
  /** What was busy around the worst frame ("" for nothing). */
  worstDuring: string;
}

export interface DiagnosticsState {
  /** True while the panel is showing (scroll timing runs only then). */
  enabled: boolean;
  pages: Map<string, PageStat>;
  view: ViewStat | null;
  scroll: ScrollStat | null;
  /** Per drawing: how long its PDF took to open, and its size. */
  pdfs: Map<string, { ms: number; bytes: number }>;
  /** The latest render errors, newest last. */
  errors: { time: number; message: string }[];
  /**
   * The last stretch of PDF drawing: how long, the longest the screen
   * went without a new frame, and the longest the main thread (touches,
   * the app's code) was held up, with what was busy then. Time while the
   * app isn't on screen doesn't count.
   */
  drawing: {
    seconds: number;
    longestFreezeMs: number;
    longestBlockMs: number;
    blockDuring: string;
  } | null;
  /** Where pages are drawn from the PDF (pageDrawer.ts); null until the first. */
  drawingThread: string | null;
}

export const diagnostics: DiagnosticsState = {
  enabled: false,
  pages: new Map(),
  view: null,
  scroll: null,
  pdfs: new Map(),
  errors: [],
  drawing: null,
  drawingThread: null,
};

const MAX_ERRORS = 5;

/** Notes a render (or PDF) error, kept even while the panel is hidden. */
export function recordError(what: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  diagnostics.errors.push({ time: Date.now(), message: `${what}: ${message}` });
  if (diagnostics.errors.length > MAX_ERRORS) diagnostics.errors.shift();
}

/** The page's record, created on first use. */
export function pageStat(
  key: string,
  drawingId: string,
  number: number,
  widthPt: number,
  heightPt: number,
): PageStat {
  let stat = diagnostics.pages.get(key);
  if (!stat) {
    stat = {
      drawingId,
      number,
      widthPt,
      heightPt,
      base: null,
      sharp: null,
    };
    diagnostics.pages.set(key, stat);
  }
  stat.number = number;
  return stat;
}

/**
 * What can be busy while the document scrolls, to find what a long frame
 * coincided with (step 10b).
 */
export type Activity =
  "base" | "sharp" | "saved image" | "saving" | "background";

const busy = new Map<Activity, number>();
/** Activities that ended since the last frame (a long one may be theirs). */
const endedSinceFrame = new Set<Activity>();

export function beginActivity(kind: Activity) {
  busy.set(kind, (busy.get(kind) ?? 0) + 1);
  if (diagnostics.enabled && !watching) watchDrawing();
  if (watching && PDF_DRAWING.includes(kind)) watching.pdf = true;
}

// --- how long the screen froze while drawing --------------------------------

/** Activities that draw from the PDF (the others show or save images). */
const PDF_DRAWING: Activity[] = ["base", "sharp", "background"];

/** Timer step for measuring how long the main thread is held up. */
const TICK_MS = 16;

let watching: {
  start: number;
  lastFrame: number;
  lastTick: number;
  longestFrame: number;
  longestBlock: number;
  blockDuring: string;
  /** Whether a PDF drawing ran in this stretch. */
  pdf: boolean;
  /** Time not on screen, left out. */
  hiddenMs: number;
} | null = null;

function watchDrawing() {
  const now = performance.now();
  const w = {
    start: now,
    lastFrame: now,
    lastTick: now,
    longestFrame: 0,
    longestBlock: 0,
    blockDuring: "",
    pdf: false,
    hiddenMs: 0,
  };
  watching = w;
  const finish = (t: number) => {
    if (watching !== w) return;
    watching = null;
    window.clearTimeout(timer);
    if (!w.pdf) return;
    diagnostics.drawing = {
      seconds: (t - w.start - w.hiddenMs) / 1000,
      longestFreezeMs: w.longestFrame,
      longestBlockMs: w.longestBlock,
      blockDuring: w.blockDuring,
    };
  };
  // Screen updates: the longest gap between frames.
  const frame = (t: number) => {
    if (watching !== w) return;
    if (!document.hidden)
      w.longestFrame = Math.max(w.longestFrame, t - w.lastFrame);
    w.lastFrame = t;
    if (anyBusy()) requestAnimationFrame(frame);
    else finish(t);
  };
  requestAnimationFrame(frame);
  // The main thread: a timer that runs late was held up (timers run
  // whether or not the screen changes).
  let timer = 0;
  const tick = () => {
    if (watching !== w) return;
    const t = performance.now();
    const late = t - w.lastTick - TICK_MS;
    if (document.hidden) w.hiddenMs += t - w.lastTick;
    else if (late > w.longestBlock) {
      w.longestBlock = late;
      w.blockDuring = busySummary();
    }
    w.lastTick = t;
    timer = window.setTimeout(tick, TICK_MS);
  };
  timer = window.setTimeout(tick, TICK_MS);
}

export function endActivity(kind: Activity) {
  busy.set(kind, Math.max(0, (busy.get(kind) ?? 0) - 1));
  endedSinceFrame.add(kind);
}

function anyBusy() {
  for (const n of busy.values()) if (n > 0) return true;
  return false;
}

/** What is busy now or ended since the last frame, e.g. "2 base, saving". */
function busySummary(): string {
  const parts: string[] = [];
  for (const [kind, n] of busy)
    if (n > 0) parts.push(n > 1 ? `${n} ${kind}` : kind);
  for (const kind of endedSinceFrame)
    if (!busy.get(kind)) parts.push(`${kind} ending`);
  return parts.join(", ");
}

/** A render (or saved image) starting now. */
export function startRender(
  scale: number,
  wanted: number,
  limit: RenderStat["limit"],
  pixels: number,
  kind: Activity,
): RenderStat {
  beginActivity(kind);
  return {
    scale,
    wanted,
    limit,
    pixels,
    ms: 0,
    state: "drawing",
    started: performance.now(),
    kind,
  };
}

/** Marks a render finished (or cancelled, or failed). */
export function endRender(stat: RenderStat, state: RenderStat["state"]) {
  if (stat.state !== "drawing") return;
  endActivity(stat.kind);
  stat.state = state;
  stat.ms = performance.now() - stat.started;
}

// --- scroll smoothness ----------------------------------------------------

/** A scroll counts as over this long after its last scroll event. */
const SCROLL_END_MS = 250;

let scrolling: {
  start: number;
  last: number;
  lastEvent: number;
  frames: number;
  worst: number;
  worstDuring: string;
  /** Frames during which a page was being drawn. */
  busy: number;
  /** What was busy at the last frame. */
  lastBusy: string;
} | null = null;

function scrollFrame(now: number) {
  const s = scrolling;
  if (!s) return;
  const nowBusy = busySummary();
  endedSinceFrame.clear();
  if (now - s.last > s.worst) {
    s.worst = now - s.last;
    s.worstDuring = [...new Set([s.lastBusy, nowBusy].join(", ").split(", "))]
      .filter(Boolean)
      .join(", ");
  }
  s.lastBusy = nowBusy;
  s.last = now;
  s.frames += 1;
  if (anyBusy()) s.busy += 1;
  if (now - s.lastEvent > SCROLL_END_MS) {
    // Over: the frames up to the last scroll event.
    const seconds = (s.lastEvent - s.start) / 1000;
    if (seconds > 0.1)
      diagnostics.scroll = {
        seconds,
        fps: s.frames / ((now - s.start) / 1000),
        worstMs: s.worst,
        drawingShare: s.frames ? s.busy / s.frames : 0,
        worstDuring: s.worstDuring,
      };
    scrolling = null;
    return;
  }
  requestAnimationFrame(scrollFrame);
}

/** The document scrolled: times the frames while it keeps scrolling. */
export function noteScroll() {
  if (!diagnostics.enabled) return;
  const now = performance.now();
  if (scrolling) {
    scrolling.lastEvent = now;
    return;
  }
  scrolling = {
    start: now,
    last: now,
    lastEvent: now,
    frames: 0,
    worst: 0,
    worstDuring: "",
    busy: 0,
    lastBusy: busySummary(),
  };
  requestAnimationFrame(scrollFrame);
}
