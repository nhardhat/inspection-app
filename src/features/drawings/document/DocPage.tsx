import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "../pdf/pdfjs";
import type { Rect } from "../viewer/viewTransform";
import { ViewerCoordsContext, type ViewerCoords } from "../viewer/viewerCoords";
import {
  beginActivity,
  diagnostics,
  endActivity,
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
  distanceTo,
  keepPageImage,
  piecesCost,
  queuePageDrawing,
  sharpPieces,
  sharpTarget,
  takePageImage,
} from "./pageImages";
import { loadSavedPage, savePageSoon } from "./savedPages";
/** A preview while scrolling: this fraction of the base's width (1/16 the pixels). */
const PREVIEW_FRACTION = 0.25;

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
  /**
   * The document is scrolling or zooming: no full-detail drawing starts
   * (a quick preview stands in) until it stops (step 10b).
   */
  moving: boolean;
  overlay?: ReactNode;
  clientToNormalised: (
    clientX: number,
    clientY: number,
  ) => { x: number; y: number };
  onRendered: (key: string) => void;
  /**
   * Registers a way to cancel the sharp render in progress (a pinch pauses
   * drawing); returns the unregister function.
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

/** The kept-images key: the page's place and the PDF page it shows. */
const imageKey = (page: PageLayout) => `${page.key}@${page.source}`;

/**
 * One page of the inspection document. Drawn in its own points inside a box
 * scaled to the document width, so overlays (the notes box) use page units.
 * While active it shows a quick preview, then (once scrolling stops, one
 * page at a time, pages on screen first) its base image at fit-width
 * quality, then sharpens the visible part after each gesture settles. Its
 * base image is kept for a while when it goes off screen (pageImages.ts).
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
  const tileHost = useRef<HTMLDivElement>(null);
  const [proxy, setProxy] = useState<PDFPageProxy | null>(null);
  // The pdf.js page whose full base image is showing.
  const [renderedProxy, setRenderedProxy] = useState<PDFPageProxy | null>(null);
  const rendered = proxy !== null && renderedProxy === proxy;
  // The pdf.js page for which no saved image was found (so it's drawn).
  const [savedChecked, setSavedChecked] = useState<PDFPageProxy | null>(null);
  const noSavedImage = proxy !== null && savedChecked === proxy;
  /** The full base image's scale (0 while only a preview, or nothing, shows). */
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

  /** Shows a finished full base image (replacing any preview). */
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

  // The full base image at fit-width quality: kept from earlier, or its
  // saved image (savedPages.ts), else drawn once the document stops moving,
  // one page at a time, then saved.
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
    const kept = takePageImage(imageKey(page), scale);
    if (kept) {
      stat.base = startRender(
        scale,
        wanted,
        limit,
        kept.width * kept.height,
        "base",
        true,
      );
      // Shown straight after this effect; the preview needn't start.
      baseScale.current = scale;
      let current = true;
      queueMicrotask(() => {
        if (current) showBase(kept, scale, proxy);
        else keepPageImage(imageKey(page), kept, scale);
      });
      return () => {
        current = false;
      };
    }
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

  // A quick low-detail preview until the full base image is drawn, so a
  // page coming on screen mid-scroll isn't blank (step 10b); not needed
  // when it has a saved image.
  useEffect(() => {
    if (!proxy || !fitQuality || !noSavedImage || baseScale.current > 0) return;
    const { wanted, scale: full } = baseTarget(
      page.size,
      page.scale,
      fitQuality,
    );
    const scale = full * PREVIEW_FRACTION;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(page.size.width * scale));
    canvas.height = Math.max(1, Math.round(page.size.height * scale));
    canvas.className = "viewer-base viewer-preview";
    const diag = startRender(
      scale,
      wanted,
      "preview",
      canvas.width * canvas.height,
      "preview",
    );
    pageStat(
      page.key,
      page.drawingId,
      page.number,
      page.size.width,
      page.size.height,
    ).preview = diag;
    const task = proxy.render({
      canvas,
      viewport: proxy.getViewport({ scale }),
    });
    let current = true;
    task.promise.then(
      () => {
        endRender(diag, "done");
        // Not over a full image that arrived first.
        if (!current || baseScale.current > 0) return releaseCanvas(canvas);
        clearHost(baseHost.current);
        baseHost.current?.appendChild(canvas);
      },
      (error: unknown) => {
        releaseCanvas(canvas);
        if (isCancel(error)) return endRender(diag, "cancelled");
        endRender(diag, "failed");
        recordError(`Page ${page.number} preview failed`, error);
      },
    );
    return () => {
      current = false;
      task.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    proxy,
    fitQuality,
    noSavedImage,
    page.key,
    page.scale,
    page.size.width,
    page.size.height,
  ]);

  // Off screen: keep the full base image a while (pageImages.ts) and let
  // the rest go. Unmounting lets everything go.
  useEffect(() => {
    if (active) return;
    const base = baseHost.current?.querySelector<HTMLCanvasElement>(
      "canvas.viewer-base:not(.viewer-preview)",
    );
    if (base && baseScale.current > 0)
      keepPageImage(imageKey(page), base, baseScale.current);
    clearHost(baseHost.current);
    clearHost(tileHost.current);
    baseScale.current = 0;
    diagnostics.pages.delete(page.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, page.key]);
  useEffect(() => {
    const base = baseHost.current;
    const tile = tileHost.current;
    return () => {
      clearHost(base);
      clearHost(tile);
      diagnostics.pages.delete(page.key);
    };
  }, [page.key]);

  // Sharpen the visible part once the view settles (step 10b). From the
  // iPad diagnostics on a busy B1 sheet (hatching): a sharp drawing took
  // over 4 s, and one drawing step could freeze the screen for 1.7 s when
  // you started moving mid-way (pdf.js only stops between steps). So the
  // sharp image is drawn in pieces about a quarter of a screen across, on
  // a grid fixed to the page (panning reuses them), nearest the middle
  // first, 0.6 s after the view settles, one at a time and never while the
  // document moves; moving stops between pieces and keeps those done. Each
  // piece is drawn from the PDF's vectors at full screen detail, so the
  // finished page is as crisp as one drawn whole. The pieces cover a
  // margin round the view (within the budget) and are kept while they're
  // at the right detail.
  const pieces = useRef<{
    scale: number;
    map: Map<string, HTMLCanvasElement>;
  } | null>(null);
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
    const dropAll = () => {
      clearHost(tileHost.current);
      pieces.current = null;
    };
    if (!part || wanted <= baseScale.current * 1.1) {
      if (!moving) {
        dropAll();
        stat.sharp = null;
      }
      return;
    }
    if (moving) return;
    const budget = SHARP_BUDGET / Math.max(1, view.visibleCount);
    const { rect, scale } = sharpTarget(
      page.size,
      part,
      wanted,
      budget,
      (area, at) => piecesCost(page.size, area, at),
    );
    // A new level of detail starts a new set; the old pieces stay on show
    // (softer, or sharper than needed) until the first new one arrives.
    let old: HTMLCanvasElement[] = [];
    if (
      !pieces.current ||
      Math.abs(pieces.current.scale - scale) > scale * 0.02
    ) {
      old = [...(pieces.current?.map.values() ?? [])];
      pieces.current = { scale, map: new Map() };
    }
    const set = pieces.current;
    const grid = sharpPieces(page.size, rect, scale);
    // Pieces outside the area now wanted go (memory).
    const wantedKeys = new Set(grid.map((g) => g.key));
    for (const [key, canvas] of set.map)
      if (!wantedKeys.has(key)) {
        releaseCanvas(canvas);
        set.map.delete(key);
      }
    const missing = grid
      .filter((g) => !set.map.has(g.key))
      .sort((a, b) => distanceTo(a.rect, part) - distanceTo(b.rect, part));
    const total = grid.length;
    const pixels = grid.reduce((n, g) => n + g.width * g.height, 0);
    const summary = stat.sharp?.pieces ? stat.sharp : null;
    stat.sharp = {
      scale,
      wanted,
      limit: scale < wanted * 0.999 ? "budget" : null,
      pixels,
      ms: summary && missing.length === 0 ? summary.ms : 0,
      state: missing.length ? "drawing" : "done",
      started: performance.now(),
      kind: "sharp",
      pieces: { done: total - missing.length, total },
    };
    const sharp = stat.sharp;
    if (missing.length === 0) {
      for (const canvas of old) releaseCanvas(canvas);
      return;
    }

    let current = true;
    const cancels: (() => void)[] = [];
    const tasks = new Set<RenderTask>();
    const timer = window.setTimeout(() => {
      for (const piece of missing) {
        // Pieces showing the view first, then the margin round it.
        const onScreen = distanceTo(piece.rect, part) === 0;
        cancels.push(
          queuePageDrawing(onScreen ? 0 : 1, (done) => {
            const canvas = document.createElement("canvas");
            canvas.width = piece.width;
            canvas.height = piece.height;
            Object.assign(canvas.style, {
              left: `${piece.rect.x}px`,
              top: `${piece.rect.y}px`,
              width: `${piece.rect.width}px`,
              height: `${piece.rect.height}px`,
            });
            beginActivity("sharp");
            const t = proxy.render({
              canvas,
              viewport: proxy.getViewport({
                scale,
                offsetX: -piece.rect.x * scale,
                offsetY: -piece.rect.y * scale,
              }),
            });
            tasks.add(t);
            t.promise.then(
              () => {
                endActivity("sharp");
                tasks.delete(t);
                done();
                if (!current || pieces.current !== set)
                  return releaseCanvas(canvas);
                for (const c of old) releaseCanvas(c);
                old = [];
                tileHost.current?.appendChild(canvas);
                set.map.set(piece.key, canvas);
                sharp.pieces!.done += 1;
                if (sharp.pieces!.done >= sharp.pieces!.total) {
                  sharp.state = "done";
                  sharp.ms = performance.now() - sharp.started;
                }
              },
              (error: unknown) => {
                endActivity("sharp");
                tasks.delete(t);
                done();
                releaseCanvas(canvas);
                if (isCancel(error)) return;
                sharp.state = "failed";
                recordError(`Page ${page.number} sharp render failed`, error);
                console.error("Tile render failed", error);
              },
            );
            return () => t.cancel();
          }),
        );
      }
    }, SHARP_DELAY_MS);
    // A pinch stops it; the next settled view carries on.
    const stop = () => {
      window.clearTimeout(timer);
      for (const cancel of cancels) cancel();
      for (const t of tasks) t.cancel();
      if (sharp.state === "drawing") sharp.state = "cancelled";
    };
    const unregister = registerRender(stop);
    return () => {
      current = false;
      unregister();
      stop();
    };
  }, [proxy, view, moving, rendered, page, registerRender]);

  // Off screen, its sharp pieces went with the page's canvases.
  useEffect(() => {
    if (!active) pieces.current = null;
  }, [active]);

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
        <div ref={tileHost} className="viewer-layer" />
        {active && (
          <ViewerCoordsContext.Provider value={coords}>
            {overlay}
          </ViewerCoordsContext.Provider>
        )}
      </div>
    </div>
  );
}
