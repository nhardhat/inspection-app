import { ChevronLeft, Minus, Plus, Share } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "../features/drawings/pdf/pdfjs";
import {
  closeDrawing,
  drawPage,
  type PageDrawing,
} from "../features/drawings/document/pageDrawer";
import { paperLabel } from "./paperLabel";

interface Props {
  title: string;
  /** The PDF's bytes (a bundled document, or an exported pack). */
  load: () => Promise<ArrayBuffer>;
  onClose: () => void;
  /**
   * Share… in the bar (engineer, 2026-10-07): gets the loaded bytes, so the
   * iPad's Share sheet opens straight from the tap.
   */
  onShare?: (bytes: ArrayBuffer) => void;
}

/** The widest page's image is at most this many device px across. */
const MAX_PAGE_PX = 3000;
const MIN_ZOOM = 1;
/** Engineer, 2026-10-16 (was 6×). */
const MAX_ZOOM = 10;
/** How long the view must be still before the part on screen is sharpened. */
const SHARP_DELAY_MS = 200;

interface PageInfo {
  /** Size in points. */
  width: number;
  height: number;
  /** Its width as a share of the widest page's (1 for the widest). */
  share: number;
  label: string;
  /** Its image (a lossless PNG), once drawn. */
  url: string | null;
  /** The image's width in device px. */
  imageWidth: number;
}

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** Frees a sharp copy's memory (iPad Safari limits canvas memory). */
function drop(canvas: HTMLCanvasElement | null | undefined) {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
  canvas.remove();
}

/**
 * A PDF shown inside the app, full screen, with a Back button (engineer,
 * 2026-10-07): an iPad home-screen app has no browser controls, so a PDF
 * opened as a page left no way back. Pages keep their sizes relative to
 * each other (an A4 memo beside an A1 drawing is a quarter as wide, as in a
 * PDF reader), each labelled with its paper size.
 *
 * Sharp when zoomed (engineer, 2026-10-16): each page is drawn once as a
 * lossless image at fit width, in the background (pageDrawer.ts); up to
 * 10× zoom, the part of each page on screen is drawn again from the PDF's
 * vectors at full screen detail once the view is still. A pinch scales
 * the pages around the fingers as one picture and lays them out when it
 * ends; − and + zoom about the middle of the screen.
 */
export function PdfViewer({ title, load, onClose, onShare }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  // The PDF as loaded, for Share.
  const loaded = useRef<ArrayBuffer | null>(null);
  const [canShare, setCanShare] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  // The zoom as last set, for a pinch to start from.
  const zoomRef = useRef(MIN_ZOOM);
  // Where the view should be once a new zoom is laid out.
  const anchor = useRef<{
    /** Content point (px at the old zoom) that stays under `at`. */
    x: number;
    y: number;
    at: { x: number; y: number };
    ratio: number;
  } | null>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  // This opening's own id for the background drawer.
  const [drawerId] = useState(() => `viewer:${crypto.randomUUID()}`);
  const sheets = useRef(new Map<number, HTMLDivElement>());
  // Bumped when the view settles, to sharpen what's on screen.
  const [settled, setSettled] = useState(0);

  /** Zooms to `z`, keeping the content under `at` (scroller px) in place. */
  function zoomTo(z: number, at?: { x: number; y: number }) {
    const el = scroller.current;
    const next = clampZoom(z);
    if (!el || next === zoomRef.current) return;
    const point = at ?? { x: el.clientWidth / 2, y: el.clientHeight / 2 };
    anchor.current = {
      x: el.scrollLeft + point.x,
      y: el.scrollTop + point.y,
      at: point,
      ratio: next / zoomRef.current,
    };
    zoomRef.current = next;
    setZoom(next);
  }

  // A new zoom keeps its anchor point in place; sharp copies laid out for
  // the old zoom go (the view is sharpened again).
  useLayoutEffect(() => {
    for (const sheet of sheets.current.values())
      drop(sheet.querySelector("canvas"));
    const el = scroller.current;
    const a = anchor.current;
    if (!el || !a) return;
    anchor.current = null;
    el.scrollLeft = a.x * a.ratio - a.at.x;
    el.scrollTop = a.y * a.ratio - a.at.y;
    setSettled((n) => n + 1);
  }, [zoom]);

  useEffect(() => {
    let current = true;
    const urls: string[] = [];
    void (async () => {
      try {
        const [{ loadPdf }, bytes] = await Promise.all([
          import("../features/drawings/pdf/pdfjs"),
          load(),
        ]);
        loaded.current = bytes;
        if (current) setCanShare(true);
        // pdf.js may take over the buffer it is given: it gets a copy.
        const pdf = await loadPdf(new Uint8Array(bytes.slice(0)));
        if (!current) return void pdf.loadingTask.destroy();
        pdfRef.current = pdf;
        // The widest page sets the scale for all of them.
        const sizes: { width: number; height: number }[] = [];
        for (let n = 1; n <= pdf.numPages; n++) {
          const v = (await pdf.getPage(n)).getViewport({ scale: 1 });
          sizes.push({ width: v.width, height: v.height });
        }
        const widest = Math.max(...sizes.map((s) => s.width));
        if (!current) return;
        // Each page's image at fit width (device px).
        const pxPerPt =
          Math.min(
            (scroller.current?.clientWidth || 800) *
              (window.devicePixelRatio || 1),
            MAX_PAGE_PX,
          ) / widest;
        setPages(
          sizes.map(({ width, height }, i) => ({
            width,
            height,
            share: width / widest,
            label: `Page ${i + 1} · ${paperLabel(width, height)}`,
            url: null,
            imageWidth: Math.round(width * pxPerPt),
          })),
        );
        setState("ready");
        // One at a time, in the background.
        for (let n = 1; n <= pdf.numPages && current; n++) {
          const { width, height } = sizes[n - 1];
          const drawn = await drawPage(pdf, drawerId, {
            source: n,
            scale: pxPerPt,
            width: Math.round(width * pxPerPt),
            height: Math.round(height * pxPerPt),
            show: false,
            png: true,
          }).promise;
          const png = await drawn.png;
          if (!png || !current) continue;
          const url = URL.createObjectURL(
            new Blob([png], { type: "image/png" }),
          );
          urls.push(url);
          setPages((list) =>
            list.map((p, i) => (i === n - 1 ? { ...p, url } : p)),
          );
        }
      } catch (e) {
        console.error("PDF viewer failed", e);
        if (current) setState("error");
      }
    })();
    return () => {
      current = false;
      for (const url of urls) URL.revokeObjectURL(url);
      closeDrawing(drawerId);
      void pdfRef.current?.loadingTask.destroy();
      pdfRef.current = null;
    };
    // Loads once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The keyboard's Escape goes back too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Scrolling settles: sharpen what's on screen.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let timer = 0;
    const onScroll = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setSettled((n) => n + 1), 100);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.clearTimeout(timer);
      el.removeEventListener("scroll", onScroll);
    };
  }, []);

  // Two fingers zoom the pages (not the whole app): the column scales
  // around the fingers as one picture, laid out at the new zoom on lift.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let start: { dist: number; mid: { x: number; y: number } } | null = null;
    let scale = 1;
    const dist = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const mid = (t: TouchList) => {
      const box = el.getBoundingClientRect();
      return {
        x: (t[0].clientX + t[1].clientX) / 2 - box.left,
        y: (t[0].clientY + t[1].clientY) / 2 - box.top,
      };
    };
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      start = { dist: dist(e.touches), mid: mid(e.touches) };
      scale = 1;
      const col = column.current;
      if (col) {
        col.style.transformOrigin = `${el.scrollLeft + start.mid.x}px ${el.scrollTop + start.mid.y}px`;
        col.style.willChange = "transform";
      }
    };
    const onMove = (e: TouchEvent) => {
      if (!start || e.touches.length !== 2) return;
      e.preventDefault();
      scale =
        clampZoom((zoomRef.current * dist(e.touches)) / start.dist) /
        zoomRef.current;
      if (column.current) column.current.style.transform = `scale(${scale})`;
    };
    const onEnd = (e: TouchEvent) => {
      if (!start || e.touches.length >= 2) return;
      const col = column.current;
      if (col) {
        col.style.transform = "";
        col.style.willChange = "";
      }
      const at = start.mid;
      start = null;
      zoomTo(zoomRef.current * scale, at);
    };
    const stop = (e: Event) => e.preventDefault();
    el.addEventListener("touchstart", onStart, { passive: false });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    el.addEventListener("gesturestart", stop);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
      el.removeEventListener("gesturestart", stop);
    };
  }, []);

  // Once still, the part of each page on screen is drawn again from the
  // PDF at full screen detail, laid over its image at true size.
  useEffect(() => {
    const el = scroller.current;
    const pdf = pdfRef.current;
    if (!el || !pdf || state !== "ready") return;
    const drawings: PageDrawing[] = [];
    const timer = window.setTimeout(() => {
      const view = el.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      pages.forEach((info, i) => {
        const sheet = sheets.current.get(i + 1);
        if (!sheet) return;
        const box = sheet.getBoundingClientRect();
        const left = Math.max(box.left, view.left);
        const top = Math.max(box.top, view.top);
        const right = Math.min(box.right, view.right);
        const bottom = Math.min(box.bottom, view.bottom);
        // Off screen, or its image is detailed enough: no sharp copy.
        if (
          right <= left ||
          bottom <= top ||
          box.width * dpr <= info.imageWidth * 1.1
        ) {
          drop(sheet.querySelector("canvas"));
          return;
        }
        const ptPerPx = info.width / box.width;
        const part = {
          x: (left - box.left) * ptPerPx,
          y: (top - box.top) * ptPerPx,
          width: (right - left) * ptPerPx,
          height: (bottom - top) * ptPerPx,
        };
        const scale = dpr / ptPerPx;
        const d = drawPage(pdf, drawerId, {
          source: i + 1,
          scale,
          width: Math.ceil(part.width * scale),
          height: Math.ceil(part.height * scale),
          offsetX: -part.x * scale,
          offsetY: -part.y * scale,
        });
        drawings.push(d);
        d.promise.then(
          ({ canvas }) => {
            if (!canvas) return;
            canvas.className = "pdf-viewer-sharp";
            Object.assign(canvas.style, {
              left: `${part.x / ptPerPx}px`,
              top: `${part.y / ptPerPx}px`,
              width: `${canvas.width / dpr}px`,
              height: `${canvas.height / dpr}px`,
            });
            drop(sheet.querySelector("canvas"));
            sheet.appendChild(canvas);
          },
          () => undefined,
        );
      });
    }, SHARP_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      for (const d of drawings) d.cancel();
    };
  }, [settled, state, pages, drawerId]);

  return (
    <div
      className="pdf-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid="pdf-viewer"
      data-pages={pages.filter((p) => p.url).length}
    >
      <div className="pdf-viewer-bar">
        <button type="button" className="pdf-viewer-back" onClick={onClose}>
          <ChevronLeft aria-hidden="true" /> Back
        </button>
        <h2>{title}</h2>
        <div className="pdf-viewer-zoom">
          <button
            type="button"
            className="icon-button quiet"
            aria-label="Zoom out"
            disabled={zoom <= MIN_ZOOM}
            onClick={() => zoomTo(zoomRef.current / 1.5)}
          >
            <Minus aria-hidden="true" />
          </button>
          <span className="muted small" data-testid="pdf-viewer-zoom">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            className="icon-button quiet"
            aria-label="Zoom in"
            disabled={zoom >= MAX_ZOOM}
            onClick={() => zoomTo(zoomRef.current * 1.5)}
          >
            <Plus aria-hidden="true" />
          </button>
        </div>
        {onShare && (
          <button
            type="button"
            className="emphasis"
            disabled={!canShare}
            onClick={() => loaded.current && onShare(loaded.current)}
          >
            <Share aria-hidden="true" /> Share…
          </button>
        )}
      </div>
      <div ref={scroller} className="pdf-viewer-scroll">
        {state === "loading" && <p className="muted">Opening…</p>}
        {state === "error" && (
          <p role="alert" className="error">
            The PDF couldn&rsquo;t be shown.
          </p>
        )}
        <div
          ref={column}
          className="pdf-viewer-pages"
          style={{ width: `${zoom * 100}%` }}
        >
          {pages.map((p, i) => (
            <figure
              key={i}
              className="pdf-viewer-figure"
              style={{ width: `${p.share * 100}%` }}
            >
              <div
                className="pdf-viewer-sheet"
                style={{ aspectRatio: `${p.width} / ${p.height}` }}
                ref={(el) => {
                  if (el) sheets.current.set(i + 1, el);
                  else sheets.current.delete(i + 1);
                }}
              >
                {p.url && (
                  <img
                    className="pdf-viewer-page"
                    src={p.url}
                    alt={`Page ${i + 1}`}
                  />
                )}
              </div>
              <figcaption className="muted small">{p.label}</figcaption>
            </figure>
          ))}
        </div>
      </div>
    </div>
  );
}
