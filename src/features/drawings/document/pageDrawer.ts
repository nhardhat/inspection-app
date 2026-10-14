/**
 * Draws pages from their PDFs (step 10b): on a background thread when the
 * browser can (drawingWorker.ts), so touches never wait on pdf.js; else on
 * the main thread as before. One long-lived worker keeps each open
 * drawing's PDF and draws on request; stopping a drawing is heard between
 * its steps. The queue in pageImages.ts still decides what draws when.
 */
import type { PDFDocumentProxy } from "../pdf/pdfjs";
import { diagnostics, recordError } from "./diagnostics";
import type { DrawJob, DrawerRequest, DrawerResponse } from "./drawingWorker";

export interface PageDrawRequest {
  /** The PDF page number. */
  source: number;
  /** Device px per PDF point. */
  scale: number;
  /** The picture's size in pixels. */
  width: number;
  height: number;
  /** Where the page sits in the picture, in pixels (default 0). */
  offsetX?: number;
  offsetY?: number;
  /** Hand back a canvas to show (default true). */
  show?: boolean;
  /** Also make a PNG of it, to save. */
  png?: boolean;
}

export interface PageDrawn {
  /** The picture, or null when not to be shown. */
  canvas: HTMLCanvasElement | null;
  /** Its PNG when asked for (null if encoding failed). */
  png: Promise<ArrayBuffer | null>;
}

export interface PageDrawing {
  /** Rejects with a RenderingCancelledException when stopped. */
  promise: Promise<PageDrawn>;
  cancel: () => void;
}

function cancelledError() {
  const error = new Error("Drawing cancelled");
  error.name = "RenderingCancelledException";
  return error;
}

// --- the background thread ---------------------------------------------------

interface Pending {
  job: DrawJob;
  resolve: (drawn: PageDrawn) => void;
  reject: (error: Error) => void;
  png: Promise<ArrayBuffer | null>;
  resolvePng: (png: ArrayBuffer | null) => void;
}

/** Null once it turned out the browser can't draw in the background. */
let worker: Promise<Worker | null> | null = null;
const pending = new Map<number, Pending>();
/** Drawings whose PDF the worker has, once handed over. */
const opened = new Map<string, Promise<void>>();
/** Drawings that failed in the background: drawn on the main thread. */
const mainOnly = new Set<string>();
let ids = 0;

function drawOnMainFrom(why: string) {
  diagnostics.drawingThread = `main thread (${why})`;
}

function startWorker(): Promise<Worker | null> {
  worker ??= new Promise((resolve) => {
    let w: Worker;
    const give = (result: Worker | null, why = "") => {
      window.clearTimeout(timer);
      if (!result) {
        w?.terminate();
        drawOnMainFrom(why);
      } else diagnostics.drawingThread = "background";
      resolve(result);
    };
    const timer = window.setTimeout(() => give(null, "no answer"), 10_000);
    try {
      w = new Worker(new URL("./drawingWorker.ts", import.meta.url), {
        type: "module",
      });
    } catch (error) {
      recordError("Background drawing couldn't start", error);
      return give(null, "couldn't start");
    }
    w.onerror = (e) => {
      recordError("Background drawing stopped", e.message || "worker error");
      give(null, "worker error");
      worker = Promise.resolve(null);
      // Anything under way is drawn again on the main thread.
      for (const [id, p] of pending) {
        pending.delete(id);
        p.reject(new Error(e.message || "worker error"));
      }
    };
    w.onmessage = (e: MessageEvent<DrawerResponse>) => {
      const msg = e.data;
      if (msg.type === "ready") {
        if (msg.ok) give(w);
        else give(null, "not supported");
        return;
      }
      const p = pending.get(msg.id);
      if (!p) {
        if (msg.type === "image") msg.bitmap.close();
        return;
      }
      if (msg.type === "image") {
        p.resolve({ canvas: toCanvas(msg.bitmap), png: p.png });
        if (!p.job.png) pending.delete(msg.id);
      } else if (msg.type === "png") {
        pending.delete(msg.id);
        if (!p.job.image) p.resolve({ canvas: null, png: p.png });
        p.resolvePng(msg.data);
      } else {
        pending.delete(msg.id);
        p.resolvePng(null);
        p.reject(msg.cancelled ? cancelledError() : new Error(msg.message));
      }
    };
  });
  return worker;
}

/**
 * A finished picture as an ordinary canvas, like every other page image
 * (the pinch snapshot copies them; letting go frees them).
 */
function toCanvas(bitmap: ImageBitmap): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}

function drawInBackground(
  w: Worker,
  doc: PDFDocumentProxy,
  drawingId: string,
  job: DrawJob,
  stopped: () => boolean,
): { promise: Promise<PageDrawn>; cancel: () => void } {
  const id = ++ids;
  const promise = new Promise<PageDrawn>((resolve, reject) => {
    let resolvePng: (png: ArrayBuffer | null) => void = () => {};
    const png = new Promise<ArrayBuffer | null>((r) => (resolvePng = r));
    const entry: Pending = { job, resolve, reject, png, resolvePng };
    void (async () => {
      let handed = opened.get(drawingId);
      if (!handed) {
        handed = (async () => {
          // A copy of the PDF for the worker's own pdf.js (handed over).
          const bytes = await doc.getData();
          const data = (
            bytes.byteOffset === 0 &&
            bytes.byteLength === bytes.buffer.byteLength
              ? bytes.buffer
              : bytes.slice().buffer
          ) as ArrayBuffer;
          w.postMessage(
            { type: "open", drawingId, data } satisfies DrawerRequest,
            [data],
          );
        })();
        opened.set(drawingId, handed);
      }
      try {
        await handed;
      } catch (error) {
        if (opened.get(drawingId) === handed) opened.delete(drawingId);
        return reject(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
      if (stopped()) return reject(cancelledError());
      pending.set(id, entry);
      w.postMessage({ type: "draw", id, ...job } satisfies DrawerRequest);
    })();
  });
  return {
    promise,
    cancel: () => {
      if (pending.has(id))
        w.postMessage({ type: "cancel", id } satisfies DrawerRequest);
    },
  };
}

// --- the main thread (fallback) ------------------------------------------------

function encodePng(canvas: HTMLCanvasElement): Promise<ArrayBuffer | null> {
  return new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  )
    .then((blob) => blob?.arrayBuffer() ?? null)
    .catch(() => null);
}

function drawOnMainThread(
  doc: PDFDocumentProxy,
  job: DrawJob,
  stopped: () => boolean,
  onTask: (cancel: () => void) => void,
): Promise<PageDrawn> {
  return (async () => {
    const page = await doc.getPage(job.source);
    if (stopped()) throw cancelledError();
    const canvas = document.createElement("canvas");
    canvas.width = job.width;
    canvas.height = job.height;
    const task = page.render({
      canvas,
      viewport: page.getViewport({
        scale: job.scale,
        offsetX: job.offsetX,
        offsetY: job.offsetY,
      }),
    });
    onTask(() => task.cancel());
    try {
      await task.promise;
    } catch (error) {
      canvas.width = canvas.height = 0;
      throw error;
    }
    const png = job.png ? encodePng(canvas) : Promise.resolve(null);
    if (job.image) return { canvas, png };
    void png.finally(() => (canvas.width = canvas.height = 0));
    await png;
    return { canvas: null, png };
  })();
}

// --- drawing a page -------------------------------------------------------------

/**
 * Draws (part of) a page: in the background where possible, else on the
 * main thread. A drawing that fails in the background is tried once on the
 * main thread, and that drawing's later pages are drawn there too.
 */
export function drawPage(
  doc: PDFDocumentProxy,
  drawingId: string,
  request: PageDrawRequest,
): PageDrawing {
  const job: DrawJob = {
    drawingId,
    source: request.source,
    scale: request.scale,
    width: request.width,
    height: request.height,
    offsetX: request.offsetX ?? 0,
    offsetY: request.offsetY ?? 0,
    image: request.show ?? true,
    png: request.png ?? false,
  };
  let isStopped = false;
  const stopped = () => isStopped;
  let stop: () => void = () => {};
  const onMain = () =>
    drawOnMainThread(doc, job, stopped, (cancel) => (stop = cancel));

  const promise = (async () => {
    const w = mainOnly.has(drawingId) ? null : await startWorker();
    if (stopped()) throw cancelledError();
    if (!w) return onMain();
    const background = drawInBackground(w, doc, drawingId, job, stopped);
    stop = background.cancel;
    try {
      return await background.promise;
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === "RenderingCancelledException"
      )
        throw error;
      recordError(`Page ${job.source} background drawing failed`, error);
      mainOnly.add(drawingId);
      if (stopped()) throw cancelledError();
      return onMain();
    }
  })();
  return {
    promise,
    cancel: () => {
      isStopped = true;
      stop();
    },
  };
}

/** The drawing's PDF closed: the worker lets its copy go too. */
export function closeDrawing(drawingId: string) {
  if (!opened.delete(drawingId)) return;
  void worker?.then((w) =>
    w?.postMessage({ type: "close", drawingId } satisfies DrawerRequest),
  );
}
