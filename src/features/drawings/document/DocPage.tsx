import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "../pdf/pdfjs";
import type { Rect } from "../viewer/viewTransform";
import { ViewerCoordsContext, type ViewerCoords } from "../viewer/viewerCoords";
import {
  diagnostics,
  endRender,
  pageStat,
  recordError,
  startRender,
} from "./diagnostics";
import { visiblePart, type PageLayout } from "./documentLayout";
import {
  SHARP_BUDGET,
  SHARP_DELAY_MS,
  baseTarget,
  covers,
  placeSharpImage,
  queuePageDrawing,
  sharpTarget,
} from "./pageImages";
import { loadSavedPage, savePageSoon } from "./savedPages";

export interface SettledView {
  /** Visible document rectangle (document units). */
  docRect: Rect;
  /** Device pixels per document unit at the current zoom. */
  devicePxPerDocUnit: number;
  /** Device pixels per document unit at "fit width" (base render quality). */
  fitDevicePxPerDocUnit: number;
  /** Number of pages on screen, to share the sharp-render pixel budget. */
  visibleCount: number;
}

interface Props {
  page: PageLayout;
  doc: PDFDocumentProxy | undefined;
  /** On or near the screen: render it. Otherwise release its memory. */
  active: boolean;
  view: SettledView | null;
  /** The document is scrolling or zooming: no PDF drawing starts (step 10b). */
  moving: boolean;
  overlay?: ReactNode;
  clientToNormalised: (
    clientX: number,
    clientY: number,
  ) => { x: number; y: number };
  onRendered: (key: string) => void;
  /**
   * Registers a way to cancel drawing in progress (a pinch pauses drawing);
   * returns the unregister function.
   */
  registerRender: (cancel: () => void) => () => void;
}

function isCancel(error: unknown): boolean {
  return error instanceof Error && error.name === "RenderingCancelledException";
}

function releaseCanvas(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
  canvas.remove();
}

function clearHost(host: HTMLElement | null) {
  host?.querySelectorAll("canvas").forEach((c) => releaseCanvas(c));
}

/** How long after the last touch lifts the crisp markup copy returns. */
const CRISP_AFTER_MS = 250;
/** Device pixels the crisp markup copy may cover (the view and a margin). */
const CRISP_BUDGET = 12_000_000;

/**
 * One page of the inspection document. Drawn in its own points inside a box
 * scaled to the document width, so overlays (the notes box) use page units.
 * Its base image at fit-width quality comes from its saved image
 * (savedPages.ts) or is drawn from the PDF once the document is still (one
 * page at a time, pages on screen first) and then saved. Zoomed in, the
 * view is sharpened once it settles, and the markup shows from a crisp copy
 * (both laid out at true screen size: Safari blurs content inside the
 * magnified page).
 */
export function DocPage({
  page,
  doc,
  active,
  view,
  moving,
  overlay,
  clientToNormalised,
  onRendered,
  registerRender,
}: Props) {
  const baseHost = useRef<HTMLDivElement>(null);
  const sharpHost = useRef<HTMLDivElement>(null);
  const [proxy, setProxy] = useState<PDFPageProxy | null>(null);
  // The pdf.js page whose base image is showing.
  const [renderedProxy, setRenderedProxy] = useState<PDFPageProxy | null>(null);
  const rendered = proxy !== null && renderedProxy === proxy;
  // The pdf.js page for which no saved image was found (so it's drawn).
  const [savedChecked, setSavedChecked] = useState<PDFPageProxy | null>(null);
  const noSavedImage = proxy !== null && savedChecked === proxy;
  /** The base image's scale (0 while it isn't showing). */
  const baseScale = useRef(0);
  const onRenderedRef = useRef(onRendered);
  const viewRef = useRef(view);
  useEffect(() => {
    onRenderedRef.current = onRendered;
    viewRef.current = view;
  });

  // Fetch the pdf.js page while active.
  useEffect(() => {
    if (!active || !doc) return;
    let current = true;
    let fetched: PDFPageProxy | null = null;
    void doc.getPage(page.source).then((p) => {
      fetched = p;
      if (current) setProxy(p);
    });
    return () => {
      current = false;
      setProxy(null);
      // pdf.js hands back the same page object next time: its image is
      // gone, so it must be shown again.
      setRenderedProxy(null);
      setSavedChecked(null);
      fetched?.cleanup();
    };
  }, [active, doc, page.source]);

  const fitQuality = view?.fitDevicePxPerDocUnit ?? 0;

  /** Shows a finished base image. */
  function showBase(
    canvas: HTMLCanvasElement,
    scale: number,
    shown: PDFPageProxy,
  ) {
    clearHost(baseHost.current);
    baseHost.current?.appendChild(canvas);
    baseScale.current = scale;
    setRenderedProxy(shown);
    onRenderedRef.current(page.key);
  }

  // The base image at fit-width quality: its saved image, else drawn once
  // the document stops moving, one page at a time, then saved.
  useEffect(() => {
    if (!proxy || !fitQuality || rendered) return;
    const target = baseTarget(page.size, page.scale, fitQuality);
    const { wanted, scale } = target;
    const limit = scale < wanted * 0.999 ? "cap" : null;
    const stat = pageStat(
      page.key,
      page.drawingId,
      page.number,
      page.size.width,
      page.size.height,
    );
    if (!noSavedImage) {
      // Looked for even while scrolling: no PDF drawing, decoded off the
      // main thread.
      const diag = startRender(
        scale,
        wanted,
        limit,
        target.width * target.height,
        "saved image",
      );
      stat.base = diag;
      let current = true;
      loadSavedPage(page.drawingId, page.source, target.width, target.height)
        .then((canvas) => {
          if (!current) {
            if (canvas) releaseCanvas(canvas);
            return endRender(diag, "cancelled");
          }
          if (canvas) {
            canvas.className = "viewer-base";
            endRender(diag, "saved");
            return showBase(canvas, scale, proxy);
          }
          endRender(diag, "cancelled");
          stat.base = null;
          setSavedChecked(proxy);
        })
        .catch((error: unknown) => {
          endRender(diag, "failed");
          recordError(`Page ${page.number} saved image failed`, error);
          if (current) setSavedChecked(proxy);
        });
      return () => {
        current = false;
      };
    }
    if (moving) return;
    // Pages on screen first, then the ones just off it.
    const onScreen =
      viewRef.current && visiblePart(page, viewRef.current.docRect) !== null;
    let task: RenderTask | null = null;
    let current = true;
    const cancelQueued = queuePageDrawing(onScreen ? 0 : 1, (done) => {
      const canvas = document.createElement("canvas");
      canvas.width = target.width;
      canvas.height = target.height;
      canvas.className = "viewer-base";
      const diag = startRender(
        scale,
        wanted,
        limit,
        canvas.width * canvas.height,
        "base",
      );
      stat.base = diag;
      const t = proxy.render({
        canvas,
        viewport: proxy.getViewport({ scale }),
      });
      task = t;
      t.promise.then(
        () => {
          endRender(diag, "done");
          done();
          if (!current) return releaseCanvas(canvas);
          showBase(canvas, scale, proxy);
          // Next time it shows at once (savedPages.ts).
          savePageSoon(canvas, page.drawingId, page.source);
        },
        (error: unknown) => {
          done();
          releaseCanvas(canvas);
          if (isCancel(error)) return endRender(diag, "cancelled");
          endRender(diag, "failed");
          recordError(`Page ${page.number} render failed`, error);
          console.error("Page render failed", error);
        },
      );
      return () => t.cancel();
    });
    // A pinch pauses drawing too; the next settled view starts it again.
    const unregister = registerRender(() => cancelQueued());
    return () => {
      current = false;
      unregister();
      cancelQueued();
      task?.cancel();
    };
    // Re-render only when the page, its quality target or motion changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    proxy,
    fitQuality,
    moving,
    rendered,
    noSavedImage,
    page.key,
    page.source,
    page.scale,
    page.size.width,
    page.size.height,
    page.drawingId,
    page.number,
  ]);

  // Off screen or gone: let its images go.
  useEffect(() => {
    if (active) return;
    clearHost(baseHost.current);
    clearHost(sharpHost.current);
    baseScale.current = 0;
    diagnostics.pages.delete(page.key);
  }, [active, page.key]);
  useEffect(() => {
    const base = baseHost.current;
    const sharp = sharpHost.current;
    return () => {
      clearHost(base);
      clearHost(sharp);
      diagnostics.pages.delete(page.key);
    };
  }, [page.key]);

  // Sharpen the view once it settles (step 10b): one drawing of the view
  // and a small margin, 0.6 s after the document stops, never while it
  // moves, kept while it still covers the view at the right detail. (A B1
  // sheet's readings: pdf.js works through the whole page for every
  // drawing, about 1.5 s on that sheet, so drawing it in pieces took 13 s;
  // one drawing is the least work.) Laid out at true screen size, as
  // Safari blurs anything inside the magnified page.
  const shownSharp = useRef<{ rect: Rect; scale: number } | null>(null);
  useEffect(() => {
    if (!proxy || !view || !rendered) return;
    const stat = pageStat(
      page.key,
      page.drawingId,
      page.number,
      page.size.width,
      page.size.height,
    );
    const part = visiblePart(page, view.docRect);
    const wanted = view.devicePxPerDocUnit * page.scale;
    if (!part || wanted <= baseScale.current * 1.1) {
      if (!moving) {
        clearHost(sharpHost.current);
        shownSharp.current = null;
        stat.sharp = null;
      }
      return;
    }
    if (moving) return;
    const budget = SHARP_BUDGET / Math.max(1, view.visibleCount);
    const { rect, scale } = sharpTarget(page.size, part, wanted, budget);
    // Still good: nothing to draw.
    const shown = shownSharp.current;
    if (
      shown &&
      Math.abs(shown.scale - scale) <= scale * 0.02 &&
      covers(shown.rect, part)
    )
      return;
    let task: RenderTask | null = null;
    let current = true;
    let cancelQueued = () => {};
    const timer = window.setTimeout(() => {
      cancelQueued = queuePageDrawing(0, (done) => {
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(rect.width * scale);
        canvas.height = Math.ceil(rect.height * scale);
        Object.assign(canvas.dataset, {
          x: String(rect.x),
          y: String(rect.y),
          w: String(rect.width),
          h: String(rect.height),
        });
        placeSharpImage(canvas);
        const diag = startRender(
          scale,
          wanted,
          scale < wanted * 0.999 ? "budget" : null,
          canvas.width * canvas.height,
          "sharp",
        );
        stat.sharp = diag;
        const t = proxy.render({
          canvas,
          viewport: proxy.getViewport({
            scale,
            offsetX: -rect.x * scale,
            offsetY: -rect.y * scale,
          }),
        });
        task = t;
        t.promise.then(
          () => {
            endRender(diag, "done");
            done();
            if (!current) return releaseCanvas(canvas);
            clearHost(sharpHost.current);
            sharpHost.current?.appendChild(canvas);
            shownSharp.current = { rect, scale };
          },
          (error: unknown) => {
            done();
            releaseCanvas(canvas);
            if (isCancel(error)) return endRender(diag, "cancelled");
            endRender(diag, "failed");
            recordError(`Page ${page.number} sharp render failed`, error);
            console.error("Sharp render failed", error);
          },
        );
        return () => t.cancel();
      });
    }, SHARP_DELAY_MS);
    // A pinch stops it; the next settled view draws it again.
    const stop = () => {
      window.clearTimeout(timer);
      cancelQueued();
      task?.cancel();
    };
    const unregister = registerRender(stop);
    return () => {
      current = false;
      unregister();
      stop();
    };
  }, [proxy, view, moving, rendered, page, registerRender]);

  // Off screen, its sharp image went with the page's canvases.
  useEffect(() => {
    if (!active) shownSharp.current = null;
  }, [active]);

  // Crisp markup (engineer, 2026-10-13): inside the magnified page Safari
  // shows markup from a lower-resolution copy, as it did the drawing. So
  // when zoomed in and still, a display-only copy of everything on the
  // page's overlay (marks, callouts, notes box, arrows) is laid over the
  // view at true screen size; the original stays in place, invisible but
  // still touchable, so taps and drags work as before. Touching the page or
  // moving it shows the original until it settles again; the copy follows
  // any change. Still vector: the copy is the same SVG and text, only laid
  // out at full resolution.
  const overlayHost = useRef<HTMLDivElement>(null);
  const crispHost = useRef<HTMLDivElement>(null);
  const [touching, setTouching] = useState(false);
  useEffect(() => {
    if (!touching) return;
    let timer = 0;
    // Back to the crisp copy a moment after the last finger or Pencil lifts.
    const up = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setTouching(false), CRISP_AFTER_MS);
    };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [touching]);
  useEffect(() => {
    const original = overlayHost.current;
    const crisp = crispHost.current;
    if (!original || !crisp) return;
    const hide = () => {
      crisp.replaceChildren();
      crisp.hidden = true;
      original.style.opacity = "";
    };
    if (!active || !view || !rendered || moving || touching) return hide();
    const part = visiblePart(page, view.docRect);
    const devicePx = view.devicePxPerDocUnit * page.scale;
    if (!part || devicePx <= baseScale.current * 1.1) return hide();
    const dpr = window.devicePixelRatio || 1;
    // Screen px per page point; the copy covers the view and a margin.
    const k = devicePx / dpr;
    const { rect } = sharpTarget(page.size, part, devicePx, CRISP_BUDGET);
    Object.assign(crisp.style, {
      left: `${rect.x}px`,
      top: `${rect.y}px`,
      width: `${rect.width * k}px`,
      height: `${rect.height * k}px`,
      transform: `scale(${1 / k})`,
    });
    let timer = 0;
    const build = () => {
      // Typing in a callout: the copy can't follow the text box.
      if (original.querySelector("textarea, input")) return hide();
      const inner = document.createElement("div");
      inner.className = "crisp-overlay-page";
      Object.assign(inner.style, {
        left: `${-rect.x * k}px`,
        top: `${-rect.y * k}px`,
        width: `${page.size.width}px`,
        height: `${page.size.height}px`,
        transform: `scale(${k})`,
      });
      for (const child of original.childNodes)
        inner.appendChild(child.cloneNode(true));
      // Display only: no ids or test ids twice.
      for (const el of inner.querySelectorAll("[id], [data-testid]")) {
        el.removeAttribute("id");
        el.removeAttribute("data-testid");
      }
      crisp.replaceChildren(inner);
      crisp.hidden = false;
      original.style.opacity = "0";
    };
    build();
    const observer = new MutationObserver((records) => {
      // Its own fading in and out isn't a change to copy.
      if (records.every((r) => r.target === original)) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(build, 80);
    });
    observer.observe(original, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
      hide();
    };
  }, [active, view, rendered, moving, touching, page]);

  const coords = useMemo<ViewerCoords>(
    () => ({ pageSize: page.size, clientToNormalised }),
    [page.size, clientToNormalised],
  );

  return (
    <div
      className="doc-page"
      data-testid="doc-page"
      data-key={page.key}
      data-rendered={rendered}
      style={{ top: page.top, height: page.height }}
      onPointerDownCapture={() => setTouching(true)}
    >
      <div
        className="doc-page-inner"
        data-testid="viewer-stage"
        style={{
          width: page.size.width,
          height: page.size.height,
          transform: `scale(${page.scale})`,
        }}
      >
        <div ref={baseHost} className="viewer-layer" />
        <div ref={sharpHost} className="viewer-layer" />
        <div ref={overlayHost} className="page-overlay">
          {active && (
            <ViewerCoordsContext.Provider value={coords}>
              {overlay}
            </ViewerCoordsContext.Provider>
          )}
        </div>
        <div
          ref={crispHost}
          className="crisp-overlay"
          data-testid="crisp-overlay"
          aria-hidden="true"
          hidden
        />
      </div>
    </div>
  );
}
