/**
 * Page drawing (step 10b, from the iPad diagnostics): PDF drawing runs one
 * page at a time, pages on screen first, and only while the document is
 * still; plus the sizes of a page's base and sharp images, and how a sharp
 * image is put on screen.
 */

import type { Rect } from "../viewer/viewTransform";

// --- one full-detail drawing at a time ---------------------------------------

interface Job {
  /** 0 for a page on screen, 1 for one just off it, 2 background saving. */
  priority: number;
  order: number;
  run: (done: () => void) => () => void;
  cancel: (() => void) | null;
  /** The current run (a paused job runs again from the start). */
  token: number;
}

const waiting: Job[] = [];
let running: Job | null = null;
let counter = 0;
let tokens = 0;

function start(job: Job) {
  const token = ++tokens;
  job.token = token;
  running = job;
  job.cancel = job.run(() => {
    // Only this run's end counts (not one paused and since restarted).
    if (running !== job || job.token !== token) return;
    running = null;
    next();
  });
}

function next() {
  if (running || waiting.length === 0) return;
  waiting.sort((a, b) => a.priority - b.priority || a.order - b.order);
  start(waiting.shift()!);
}

/** Stops the running job without finishing it. */
function stopRunning() {
  const job = running;
  if (!job) return null;
  running = null;
  job.token = -1;
  job.cancel?.();
  return job;
}

/**
 * Queues a full-detail page drawing. `run` starts it, calls `done` when it
 * ends either way, and returns a way to stop it. A more urgent job (a page
 * on screen) pauses a less urgent one that's running, which starts again
 * after. The result cancels it, whether waiting or running.
 */
export function queuePageDrawing(
  priority: number,
  run: (done: () => void) => () => void,
): () => void {
  const job: Job = { priority, order: counter++, run, cancel: null, token: 0 };
  waiting.push(job);
  if (running && priority < running.priority) waiting.push(stopRunning()!);
  queueMicrotask(next);
  return () => {
    const i = waiting.indexOf(job);
    if (i >= 0) waiting.splice(i, 1);
    if (running === job) {
      stopRunning();
      next();
    }
  };
}

// --- sizes -------------------------------------------------------------------

/** iPad Safari limits total canvas memory, and several pages can be live. */
export const MAX_BASE_PIXELS = 4_000_000;

/**
 * A page's base image: device pixels per point wanted at fit width, what
 * it gets (capped at MAX_BASE_PIXELS), and the canvas size.
 */
export function baseTarget(
  size: { width: number; height: number },
  pageScale: number,
  fitQuality: number,
) {
  const wanted = fitQuality * pageScale;
  const scale = Math.min(
    wanted,
    Math.sqrt(MAX_BASE_PIXELS / (size.width * size.height)),
  );
  return {
    wanted,
    scale,
    width: Math.round(size.width * scale),
    height: Math.round(size.height * scale),
  };
}

/** Device pixels for the sharp images of the pages on screen, shared. */
export const SHARP_BUDGET = 12_000_000;

/** Whether `outer` contains `inner` (page units). */
export function covers(outer: Rect, inner: Rect) {
  const e = 0.5;
  return (
    outer.x <= inner.x + e &&
    outer.y <= inner.y + e &&
    outer.x + outer.width >= inner.x + inner.width - e &&
    outer.y + outer.height >= inner.y + inner.height - e
  );
}

/**
 * The sharp image for the visible part of a page: as detailed as wanted
 * (within the budget), covering a margin of up to half the view on each
 * side so small scrolls stay sharp; the margin shrinks before the detail.
 */
export function sharpTarget(
  page: { width: number; height: number },
  part: Rect,
  wanted: number,
  budget: number,
): { rect: Rect; scale: number } {
  const around = (margin: number): Rect => {
    const mx = part.width * margin;
    const my = part.height * margin;
    const x = Math.max(0, part.x - mx);
    const y = Math.max(0, part.y - my);
    return {
      x,
      y,
      width: Math.min(page.width, part.x + part.width + mx) - x,
      height: Math.min(page.height, part.y + part.height + my) - y,
    };
  };
  for (const margin of [0.5, 0.25, 0.1, 0]) {
    const rect = around(margin);
    if (rect.width * rect.height * wanted * wanted <= budget)
      return { rect, scale: wanted };
  }
  const rect = around(0);
  return { rect, scale: Math.sqrt(budget / (rect.width * rect.height)) };
}

/** How long the view must be still before its sharp image starts drawing. */
export const SHARP_DELAY_MS = 600;

/**
 * Lays a sharp image out at its true screen size (CSS px = device px / DPR)
 * and scales it back to its place on the page (data-x, y, w, h in page
 * units), on its own layer. The engineer compared three ways on the iPad
 * (2026-10-13): inside the magnified page, even on its own layer, Safari
 * showed it from a lower-resolution copy (blurry); laid out at true size it
 * is crisp.
 */
export function placeSharpImage(canvas: HTMLCanvasElement) {
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.width / dpr;
  Object.assign(canvas.style, {
    left: `${canvas.dataset.x}px`,
    top: `${canvas.dataset.y}px`,
    width: `${cssWidth}px`,
    height: `${canvas.height / dpr}px`,
    transformOrigin: "0 0",
    transform: `scale(${Number(canvas.dataset.w) / cssWidth})`,
    willChange: "transform",
  });
}
