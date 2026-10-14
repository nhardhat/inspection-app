/// <reference lib="webworker" />
/**
 * EXPERIMENT (step 10b, 2026-10-14): pdf.js drawing on a background thread.
 * pdf.js normally draws on the main thread, the one that handles touches;
 * on a busy sheet one drawing takes ~1.5 s and the app waits. Here a second
 * copy of pdf.js runs in this worker and draws onto an OffscreenCanvas,
 * handing back a finished picture. pdf.js doesn't officially support this:
 * it gets a canvas factory that makes OffscreenCanvases, no DOM filters,
 * and draws fonts as shapes. Used only by the drawing lab (DrawingLab.tsx)
 * until it's proven on the iPad; thrown away if it isn't.
 */
import { GlobalWorkerOptions, PDFWorker, getDocument } from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
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

/** pdf.js's SVG filters need a document: none here (rare in drawings). */
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

export type LabRequest =
  | { type: "open"; data: ArrayBuffer }
  | {
      type: "render";
      id: number;
      page: number;
      /** Device px per PDF point. */
      scale: number;
      /** The part of the page to draw, in points. */
      rect: { x: number; y: number; width: number; height: number };
    };

export type LabResponse =
  | { type: "opened"; ms: number; pages: number }
  | { type: "rendered"; id: number; bitmap: ImageBitmap; ms: number }
  | { type: "error"; id?: number; message: string };

let pdf: PDFDocumentProxy | null = null;

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

const post = (msg: LabResponse, transfer: Transferable[] = []) =>
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);

self.onmessage = async (e: MessageEvent<LabRequest>) => {
  const msg = e.data;
  try {
    if (msg.type === "open") {
      const start = performance.now();
      await pdf?.loadingTask.destroy();
      pdf = await getDocument({
        data: new Uint8Array(msg.data),
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
      }).promise;
      post({
        type: "opened",
        ms: performance.now() - start,
        pages: pdf.numPages,
      });
      return;
    }
    if (!pdf) throw new Error("No PDF open");
    const start = performance.now();
    const page = await pdf.getPage(msg.page);
    const { rect, scale } = msg;
    const canvas = new OffscreenCanvas(
      Math.ceil(rect.width * scale),
      Math.ceil(rect.height * scale),
    );
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      viewport: page.getViewport({
        scale,
        offsetX: -rect.x * scale,
        offsetY: -rect.y * scale,
      }),
    }).promise;
    const bitmap = canvas.transferToImageBitmap();
    post(
      { type: "rendered", id: msg.id, bitmap, ms: performance.now() - start },
      [bitmap],
    );
  } catch (error) {
    post({
      type: "error",
      id: msg.type === "render" ? msg.id : undefined,
      message:
        error instanceof Error
          ? `${error.message} @ ${error.stack ?? ""}`
          : String(error),
    });
  }
};
