/// <reference lib="webworker" />
/**
 * Page drawing on a background thread (step 10b; proven on the iPad in the
 * drawing lab, 2026-10-14: a busy B1 page froze the screen for 1.4 s when
 * drawn on the main thread, one frame when drawn here, same picture). A
 * second copy of pdf.js keeps each drawing's PDF open and draws pages onto
 * OffscreenCanvases, handing back finished pictures (and PNGs to save).
 * pageDrawer.ts is its only user. pdf.js doesn't officially support this:
 * it gets a canvas factory that makes OffscreenCanvases, no DOM filters
 * (rare in drawings), and draws fonts as shapes.
 */
import { GlobalWorkerOptions, PDFWorker, getDocument } from "pdfjs-dist";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const data = `${import.meta.env.BASE_URL}pdfjs/`;

type CanvasAndContext = {
  canvas: OffscreenCanvas | null;
  context: OffscreenCanvasRenderingContext2D | null;
};

/** Canvases pdf.js needs along the way (patterns, masks), off screen. */
class OffscreenCanvasFactory {
  create(width: number, height: number): CanvasAndContext {
    const canvas = new OffscreenCanvas(width, height);
    return { canvas, context: canvas.getContext("2d") };
  }
  reset(cc: CanvasAndContext, width: number, height: number) {
    cc.canvas!.width = width;
    cc.canvas!.height = height;
  }
  destroy(cc: CanvasAndContext) {
    if (cc.canvas) cc.canvas.width = cc.canvas.height = 0;
    cc.canvas = null;
    cc.context = null;
  }
}

/** pdf.js's SVG filters need a document: none here. */
class NoFilterFactory {
  addFilter() {
    return "none";
  }
  addHCMFilter() {
    return "none";
  }
  addAlphaFilter() {
    return "none";
  }
  addLuminosityFilter() {
    return "none";
  }
  addKnockoutFilter() {
    return "none";
  }
  addHighlightHCMFilter() {
    return "none";
  }
  addSelectionHCMFilter() {
    return "none";
  }
  addSelectionFilter() {
    return "none";
  }
  createSelectionStyle() {
    return null;
  }
  destroy() {}
}

export interface DrawJob {
  drawingId: string;
  /** The PDF page number. */
  source: number;
  /** Device px per PDF point. */
  scale: number;
  /** The picture's size in pixels. */
  width: number;
  height: number;
  /** Where the page sits in the picture, in pixels (a part of the page). */
  offsetX: number;
  offsetY: number;
  /** Hand back the picture (for the screen). */
  image: boolean;
  /** Hand back a PNG of it (to save). */
  png: boolean;
}

export type DrawerRequest =
  | { type: "open"; drawingId: string; data: ArrayBuffer }
  | { type: "close"; drawingId: string }
  | ({ type: "draw"; id: number } & DrawJob)
  | { type: "cancel"; id: number };

export type DrawerResponse =
  | { type: "ready"; ok: boolean }
  | { type: "image"; id: number; bitmap: ImageBitmap }
  | { type: "png"; id: number; data: ArrayBuffer | null }
  | { type: "failed"; id: number; cancelled: boolean; message: string };

const post = (msg: DrawerResponse, transfer: Transferable[] = []) =>
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);

/**
 * pdf.js's own parsing worker, started here and handed over: left to
 * itself pdf.js reads window.location to start it, which a worker hasn't,
 * and falls back to loading its parser into this worker, where it takes
 * over this worker's messages.
 */
let parser: PDFWorker | null = null;
function parserWorker() {
  parser ??= new PDFWorker({
    // (pdf.js types the port as null, but it takes a Worker.)
    port: new Worker(pdfWorkerUrl, { type: "module" }) as never,
  });
  return parser;
}

const docs = new Map<string, Promise<PDFDocumentProxy>>();

function open(drawingId: string, bytes: ArrayBuffer) {
  const loading = getDocument({
    data: new Uint8Array(bytes),
    cMapUrl: `${data}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${data}standard_fonts/`,
    iccUrl: `${data}iccs/`,
    wasmUrl: `${data}wasm/`,
    // No document in a worker: fonts are drawn as shapes, and pdf.js's
    // own worker fetches its data (the default reads document.baseURI).
    disableFontFace: true,
    useWorkerFetch: true,
    worker: parserWorker(),
    CanvasFactory: OffscreenCanvasFactory,
    FilterFactory: NoFilterFactory,
  });
  const doc = loading.promise;
  // A failed open is reported by the drawings that wanted it.
  doc.catch(() => {});
  docs.set(drawingId, doc);
}

/** Drawings under way, so they can be stopped. */
const running = new Map<
  number,
  { stopped: boolean; task: RenderTask | null }
>();

async function draw(id: number, job: DrawJob) {
  const run = { stopped: false, task: null as RenderTask | null };
  running.set(id, run);
  let canvas: OffscreenCanvas | null = null;
  try {
    const doc = docs.get(job.drawingId);
    if (!doc) throw new Error("The drawing isn't open");
    const page = await (await doc).getPage(job.source);
    if (run.stopped) throw new Error("cancelled");
    canvas = new OffscreenCanvas(job.width, job.height);
    const task = page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      viewport: page.getViewport({
        scale: job.scale,
        offsetX: job.offsetX,
        offsetY: job.offsetY,
      }),
    });
    // Let messages in between drawing steps, so a stop is heard at once.
    task.onContinue = (next: () => void) => setTimeout(next, 0);
    run.task = task;
    await task.promise;
    page.cleanup();
    if (job.image) {
      // A copy when the PNG still needs the canvas.
      const bitmap = job.png
        ? await createImageBitmap(canvas)
        : canvas.transferToImageBitmap();
      post({ type: "image", id, bitmap }, [bitmap]);
    }
    if (job.png) {
      let png: ArrayBuffer | null = null;
      try {
        const blob = await canvas.convertToBlob({ type: "image/png" });
        png = await blob.arrayBuffer();
      } catch {
        // Shown but not saved: it's drawn again next time.
      }
      post({ type: "png", id, data: png }, png ? [png] : []);
    }
  } catch (error) {
    const cancelled =
      run.stopped ||
      (error instanceof Error && error.name === "RenderingCancelledException");
    post({
      type: "failed",
      id,
      cancelled,
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    running.delete(id);
    if (canvas) canvas.width = canvas.height = 0;
  }
}

self.onmessage = (e: MessageEvent<DrawerRequest>) => {
  const msg = e.data;
  if (msg.type === "open") open(msg.drawingId, msg.data);
  else if (msg.type === "close") {
    void docs.get(msg.drawingId)?.then((doc) => doc.loadingTask.destroy());
    docs.delete(msg.drawingId);
  } else if (msg.type === "draw") void draw(msg.id, msg);
  else {
    const run = running.get(msg.id);
    if (run) {
      run.stopped = true;
      run.task?.cancel();
    }
  }
};

// Whether this browser can draw here (iPadOS 16.4 and later can).
function canDraw() {
  try {
    return new OffscreenCanvas(1, 1).getContext("2d") !== null;
  } catch {
    return false;
  }
}
post({ type: "ready", ok: canDraw() });
