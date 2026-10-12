/**
 * Smoother scrolling (step 10b, engineer-agreed 2026-10-08): the iPad
 * diagnostics showed dropped frames came from pages being drawn during a
 * scroll, not from markup. So full-detail page images are drawn one at a
 * time, pages on screen first, only once scrolling stops (a quick
 * low-detail preview stands in meanwhile), and the last few pages' images
 * are kept so scrolling back doesn't draw them again.
 */

import type { Rect } from "../viewer/viewTransform";

// --- recently shown pages' images ------------------------------------------

/** Canvas pixels kept for pages that went off screen (about four A1 pages). */
const KEEP_PIXELS = 16_000_000;

interface Kept {
  canvas: HTMLCanvasElement;
  scale: number;
}

/** Most recently kept last. */
const kept = new Map<string, Kept>();

function keptPixels() {
  let total = 0;
  for (const k of kept.values()) total += k.canvas.width * k.canvas.height;
  return total;
}

function release(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
  canvas.remove();
}

/** Keeps a page's full image as it goes off screen (the oldest go first). */
export function keepPageImage(
  key: string,
  canvas: HTMLCanvasElement,
  scale: number,
) {
  const old = kept.get(key);
  if (old && old.canvas !== canvas) release(old.canvas);
  kept.delete(key);
  canvas.remove();
  kept.set(key, { canvas, scale });
  for (const [k, v] of kept) {
    if (keptPixels() <= KEEP_PIXELS) break;
    kept.delete(k);
    release(v.canvas);
  }
}

/** A kept image drawn at `scale`, handed back to its page (or null). */
export function takePageImage(
  key: string,
  scale: number,
): HTMLCanvasElement | null {
  const k = kept.get(key);
  if (!k) return null;
  kept.delete(key);
  if (Math.abs(k.scale - scale) > scale * 0.01) {
    release(k.canvas);
    return null;
  }
  return k.canvas;
}

/** Lets every kept image go (the drawings screen closed). */
export function clearPageImages() {
  for (const k of kept.values()) release(k.canvas);
  kept.clear();
}

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
  /** Device pixels it costs to cover `rect` at `scale` (the pieces'). */
  cost: (rect: Rect, scale: number) => number = (rect, scale) =>
    rect.width * rect.height * scale * scale,
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
  for (const margin of [0.5, 0.25, 0.1]) {
    const rect = around(margin);
    if (cost(rect, wanted) <= budget) return { rect, scale: wanted };
  }
  // Just the view: full detail if the view itself fits (whole pieces may
  // go a little over); detail drops only when even the view is too big.
  const rect = around(0);
  if (rect.width * rect.height * wanted * wanted <= budget)
    return { rect, scale: wanted };
  return { rect, scale: Math.sqrt(budget / (rect.width * rect.height)) };
}

/** How long the view must be still before sharp pieces start drawing. */
export const SHARP_DELAY_MS = 600;

/** A sharp piece's side, in device pixels (about a quarter of an iPad screen). */
export const PIECE_PX = 1024;

export interface SharpPiece {
  /** Grid cell, e.g. "3,2" (columns and rows fixed to the page). */
  key: string;
  /** Page units, within the page. */
  rect: Rect;
  /** Canvas size in device pixels. */
  width: number;
  height: number;
}

/**
 * The grid pieces covering `area` of a page at `scale` (device pixels per
 * point). The grid is fixed to the page's top-left at this scale, so the
 * same piece is reused while panning.
 */
export function sharpPieces(
  page: { width: number; height: number },
  area: Rect,
  scale: number,
): SharpPiece[] {
  const cell = PIECE_PX / scale;
  const e = 1e-6;
  const c0 = Math.floor(area.x / cell);
  const r0 = Math.floor(area.y / cell);
  const c1 = Math.floor((area.x + area.width - e) / cell);
  const r1 = Math.floor((area.y + area.height - e) / cell);
  const pieces: SharpPiece[] = [];
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++) {
      const x = c * cell;
      const y = r * cell;
      const rect = {
        x,
        y,
        width: Math.min(page.width, x + cell) - x,
        height: Math.min(page.height, y + cell) - y,
      };
      if (rect.width <= 0 || rect.height <= 0) continue;
      pieces.push({
        key: `${c},${r}`,
        rect,
        width: Math.ceil(rect.width * scale),
        height: Math.ceil(rect.height * scale),
      });
    }
  return pieces;
}

/** How far `rect` is from `target` (0 when they overlap), page units. */
export function distanceTo(rect: Rect, target: Rect) {
  const dx = Math.max(
    0,
    target.x - (rect.x + rect.width),
    rect.x - (target.x + target.width),
  );
  const dy = Math.max(
    0,
    target.y - (rect.y + rect.height),
    rect.y - (target.y + target.height),
  );
  return Math.hypot(dx, dy);
}

/** Device pixels of the pieces covering `area` at `scale`. */
export function piecesCost(
  page: { width: number; height: number },
  area: Rect,
  scale: number,
) {
  return sharpPieces(page, area, scale).reduce(
    (n, p) => n + p.width * p.height,
    0,
  );
}
