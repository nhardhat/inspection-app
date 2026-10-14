import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef, useState } from "react";
import { appCommit, appVersion } from "../../app/version";
import { db } from "../../db/db";
import type { LabRequest, LabResponse } from "./renderWorker";

/**
 * EXPERIMENT (step 10b, 2026-10-14): the drawing lab. Draws one page of a
 * drawing on this device two ways, on the main thread (as the viewer does)
 * and on a background thread (renderWorker.ts), timing each and measuring
 * how long the screen froze, with a moving bar to show it. Reached from
 * Settings, Drawing (with diagnostics on). Removed, with the worker, once
 * the experiment is decided. Copied results hold no drawing names.
 */

type Method = "main" | "worker";

interface Result {
  method: Method;
  zoom: number;
  ms: number;
  longestFreezeMs: number;
  pixels: number;
  error?: string;
}

const ZOOMS = [1, 2, 4, 8];

/** Times frames while `work` runs: the longest gap is the longest freeze. */
async function measured<T>(
  work: () => Promise<T>,
): Promise<{ value: T; longestFreezeMs: number }> {
  let last = performance.now();
  let longest = 0;
  let running = true;
  const frame = (t: number) => {
    longest = Math.max(longest, t - last);
    last = t;
    if (running) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  try {
    const value = await work();
    return { value, longestFreezeMs: longest };
  } finally {
    running = false;
  }
}

export function DrawingLab() {
  const drawings = useLiveQuery(() => db.drawings.toArray(), []);
  const [drawingId, setDrawingId] = useState("");
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(2);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [copied, setCopied] = useState("");
  const output = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);

  // A bar moved by script every frame: it stops when the screen freezes.
  useEffect(() => {
    let id = 0;
    const move = (t: number) => {
      if (bar.current)
        bar.current.style.transform = `translateX(${(Math.sin(t / 300) + 1) * 120}px)`;
      id = requestAnimationFrame(move);
    };
    id = requestAnimationFrame(move);
    return () => cancelAnimationFrame(id);
  }, []);

  const drawing = drawings?.find((d) => d.id === drawingId) ?? drawings?.[0];
  const pages = drawing?.pages.filter((p) => !p.hidden) ?? [];
  const source = pages[pageNumber - 1]?.source ?? 1;

  /** The middle of the page, a screen's worth, at this zoom. */
  function target(widthPt: number, heightPt: number) {
    const dpr = window.devicePixelRatio || 1;
    const view = output.current!.getBoundingClientRect();
    const w = Math.max(320, view.width) * dpr;
    const h = Math.max(320, window.innerHeight * 0.6) * dpr;
    const scale = (w / widthPt) * zoom;
    const rw = Math.min(widthPt, w / scale);
    const rh = Math.min(heightPt, h / scale);
    return {
      scale,
      rect: {
        x: (widthPt - rw) / 2,
        y: (heightPt - rh) / 2,
        width: rw,
        height: rh,
      },
    };
  }

  function show(image: CanvasImageSource, width: number, height: number) {
    const dpr = window.devicePixelRatio || 1;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")!.drawImage(image, 0, 0);
    canvas.style.width = `${width / dpr}px`;
    canvas.style.height = `${height / dpr}px`;
    output.current?.replaceChildren(canvas);
  }

  async function bytes() {
    const blob = await db.blobs.get(drawing!.pdfBlobId);
    if (!blob) throw new Error("The drawing's PDF is missing");
    return blob.data.slice(0);
  }

  async function run(method: Method) {
    if (!drawing) return;
    setBusy(true);
    const record = (r: Omit<Result, "method" | "zoom">) =>
      setResults((list) => [{ method, zoom, ...r }, ...list]);
    try {
      const size = drawing.pageSizes?.[source - 1];
      if (!size) throw new Error("The page's size isn't known");
      const [widthPt, heightPt] = size;
      const { scale, rect } = target(widthPt, heightPt);
      const pixels =
        Math.ceil(rect.width * scale) * Math.ceil(rect.height * scale);
      if (method === "main") {
        const { loadPdf } = await import("../drawings/pdf/pdfjs");
        const pdf = await loadPdf(new Uint8Array(await bytes()));
        try {
          const page = await pdf.getPage(source);
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(rect.width * scale);
          canvas.height = Math.ceil(rect.height * scale);
          const start = performance.now();
          const { longestFreezeMs } = await measured(
            () =>
              page.render({
                canvas,
                viewport: page.getViewport({
                  scale,
                  offsetX: -rect.x * scale,
                  offsetY: -rect.y * scale,
                }),
              }).promise,
          );
          record({ ms: performance.now() - start, longestFreezeMs, pixels });
          show(canvas, canvas.width, canvas.height);
        } finally {
          await pdf.loadingTask.destroy();
        }
      } else {
        const worker = new Worker(
          new URL("./renderWorker.ts", import.meta.url),
          { type: "module" },
        );
        const ask = (msg: LabRequest, transfer: Transferable[] = []) =>
          new Promise<LabResponse>((resolve) => {
            worker.onmessage = (e: MessageEvent<LabResponse>) =>
              resolve(e.data);
            worker.onerror = (e) =>
              resolve({ type: "error", message: e.message || "Worker failed" });
            worker.postMessage(msg, transfer);
          });
        try {
          const data = await bytes();
          const opened = await ask({ type: "open", data }, [data]);
          if (opened.type === "error") throw new Error(opened.message);
          const start = performance.now();
          const { value: reply, longestFreezeMs } = await measured(() =>
            ask({ type: "render", id: 1, page: source, scale, rect }),
          );
          if (reply.type !== "rendered") {
            throw new Error(
              reply.type === "error"
                ? reply.message
                : `No picture came back (${JSON.stringify(reply).slice(0, 200)})`,
            );
          }
          record({ ms: performance.now() - start, longestFreezeMs, pixels });
          show(reply.bitmap, reply.bitmap.width, reply.bitmap.height);
          reply.bitmap.close();
        } finally {
          worker.terminate();
        }
      }
    } catch (error) {
      record({
        ms: 0,
        longestFreezeMs: 0,
        pixels: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  }

  const label = (r: Result) =>
    r.error
      ? `${r.method === "main" ? "Main thread" : "Background"} ${r.zoom}×: FAILED ${r.error}`
      : `${r.method === "main" ? "Main thread" : "Background"} ${r.zoom}× · ${Math.round(r.ms)} ms · longest freeze ${Math.round(r.longestFreezeMs)} ms · ${(r.pixels / 1e6).toFixed(1)} MP`;

  async function copy() {
    const lines = [
      `Northrop Hardhat ${appVersion} (${appCommit}) · drawing lab · ${new Date().toLocaleString("en-AU")}`,
      ...results.map(label),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied("Copied");
    } catch {
      setCopied("Couldn't copy");
    }
    window.setTimeout(() => setCopied(""), 2000);
  }

  return (
    <section className="page drawing-lab" aria-labelledby="lab-heading">
      <h1 id="lab-heading">Drawing lab</h1>
      <p className="muted">
        An experiment: draws one page on the main thread (as the drawings screen
        does now) and on a background thread, to compare speed and freezes on
        this iPad. Nothing is saved.
      </p>
      {drawings && drawings.length === 0 && (
        <p className="notice">Add a drawing to an inspection first.</p>
      )}
      {drawing && (
        <div className="drawing-lab-controls">
          <label>
            Drawing
            <select
              value={drawing.id}
              onChange={(e) => {
                setDrawingId(e.target.value);
                setPageNumber(1);
              }}
            >
              {drawings!.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Page
            <select
              value={pageNumber}
              onChange={(e) => setPageNumber(Number(e.target.value))}
            >
              {pages.map((_, i) => (
                <option key={i} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </select>
          </label>
          <label>
            Zoom
            <select
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            >
              {ZOOMS.map((z) => (
                <option key={z} value={z}>
                  {z}× fit
                </option>
              ))}
            </select>
          </label>
          <button type="button" disabled={busy} onClick={() => run("main")}>
            Draw on main thread
          </button>
          <button
            type="button"
            className="emphasis"
            disabled={busy}
            onClick={() => run("worker")}
          >
            Draw in background
          </button>
        </div>
      )}
      <div className="drawing-lab-track" aria-hidden="true">
        <div ref={bar} className="drawing-lab-bar" />
      </div>
      <p className="muted small">
        The bar keeps moving unless the screen is frozen.
      </p>
      {results.length > 0 && (
        <div className="drawing-lab-results">
          <ul data-testid="lab-results">
            {results.map((r, i) => (
              <li key={i}>{label(r)}</li>
            ))}
          </ul>
          <button type="button" onClick={() => void copy()}>
            {copied || "Copy results"}
          </button>
        </div>
      )}
      <div ref={output} className="drawing-lab-output" />
    </section>
  );
}
