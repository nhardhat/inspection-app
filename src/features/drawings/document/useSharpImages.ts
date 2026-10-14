import { useEffect, useRef, type RefObject } from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "../pdf/pdfjs";
import type { Rect } from "../viewer/viewTransform";
import type { SettledView } from "./DocPage";
import {
  endRender,
  pageStat,
  recordError,
  startRender,
  type Activity,
} from "./diagnostics";
import { visiblePart, type PageLayout } from "./documentLayout";
import { drawPage, drawsInBackground, type PageDrawing } from "./pageDrawer";
import {
  SHARP_BUDGET,
  SHARP_DELAY_BACKGROUND_MS,
  SHARP_DELAY_MS,
  SHARP_KEEP,
  aheadAreas,
  aheadTarget,
  coveredBy,
  overlaps,
  placeSharpImage,
  queuePageDrawing,
  sharpTarget,
} from "./pageImages";

interface SharpImage {
  rect: Rect;
  scale: number;
  canvas: HTMLCanvasElement;
}

interface SharpJob {
  rect: Rect;
  scale: number;
  stop: () => void;
}

const sameScale = (a: number, b: number) => Math.abs(a - b) <= b * 0.02;
const pixelsOf = (r: Rect, scale: number) =>
  Math.ceil(r.width * scale) * Math.ceil(r.height * scale);
const centreDistance = (a: Rect, b: Rect) =>
  Math.hypot(
    a.x + a.width / 2 - (b.x + b.width / 2),
    a.y + a.height / 2 - (b.y + b.height / 2),
  );

function release(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
  canvas.remove();
}

function isCancel(error: unknown): boolean {
  return error instanceof Error && error.name === "RenderingCancelledException";
}

/**
 * A page's sharp images when zoomed in (step 10b). Once the view settles,
 * the view and a margin are drawn in one drawing from the PDF's vectors
 * at full screen detail (pdf.js works through the whole page for every
 * drawing, about 2 s on a busy B1, so one drawing is the least work), and
 * kept while they still cover the view. When pages draw in the background
 * it then draws ahead (engineer, 2026-10-14: usually a screen or so round
 * one spot): the areas round the view at the same zoom, nearest first,
 * keeping up to SHARP_KEEP pixels and letting the furthest go, so a
 * scroll nearby is sharp at once. Drawings carry on while the document
 * moves (they're in the background); on the main thread they stop, as a
 * drawing there freezes touches. Each image is laid out at true screen
 * size, as Safari blurs anything inside the magnified page.
 */
export function useSharpImages({
  doc,
  proxy,
  view,
  moving,
  rendered,
  active,
  page,
  baseScale,
  host,
  registerRender,
}: {
  doc: PDFDocumentProxy | undefined;
  proxy: PDFPageProxy | null;
  view: SettledView | null;
  moving: boolean;
  rendered: boolean;
  active: boolean;
  page: PageLayout;
  baseScale: RefObject<number>;
  host: RefObject<HTMLDivElement | null>;
  registerRender: (cancel: () => void) => () => void;
}) {
  const state = useRef({ images: [] as SharpImage[], jobs: [] as SharpJob[] });
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  });

  const stat = () =>
    pageStat(
      page.key,
      page.drawingId,
      page.number,
      page.size.width,
      page.size.height,
    );

  function noteKept() {
    const s = state.current;
    stat().sharpKept = s.images.length
      ? {
          images: s.images.length,
          pixels: s.images.reduce(
            (n, i) => n + i.canvas.width * i.canvas.height,
            0,
          ),
          drawing: s.jobs.length,
        }
      : null;
  }

  function drop(image: SharpImage) {
    const s = state.current;
    s.images = s.images.filter((i) => i !== image);
    release(image.canvas);
  }

  function stopJobs(which: (job: SharpJob) => boolean) {
    for (const job of [...state.current.jobs]) if (which(job)) job.stop();
  }

  function clear() {
    stopJobs(() => true);
    for (const image of [...state.current.images]) drop(image);
  }

  /** After an image lands: other zooms' images and the furthest go. */
  function tidy(scale: number) {
    const v = viewRef.current;
    const part = v && visiblePart(page, v.docRect);
    if (!v || !part) return;
    const s = state.current;
    const same = s.images.filter((i) => sameScale(i.scale, scale));
    if (
      coveredBy(
        part,
        same.map((i) => i.rect),
      )
    )
      for (const i of s.images) if (!sameScale(i.scale, scale)) drop(i);
    const keep = SHARP_KEEP / Math.max(1, v.visibleCount);
    const total = () =>
      state.current.images.reduce(
        (n, i) => n + i.canvas.width * i.canvas.height,
        0,
      );
    const furthestFirst = [...state.current.images].sort(
      (a, b) => centreDistance(b.rect, part) - centreDistance(a.rect, part),
    );
    for (const image of furthestFirst) {
      if (total() <= keep || overlaps(image.rect, part)) break;
      drop(image);
    }
  }

  function draw(
    rect: Rect,
    scale: number,
    wanted: number,
    kind: Extract<Activity, "sharp" | "ahead">,
  ) {
    if (!doc) return;
    const s = state.current;
    let stopped = false;
    let drawing: PageDrawing | null = null;
    const forget = () => {
      state.current.jobs = state.current.jobs.filter((j) => j !== job);
    };
    const cancelQueued = queuePageDrawing(kind === "sharp" ? 0 : 1, (done) => {
      const width = Math.ceil(rect.width * scale);
      const height = Math.ceil(rect.height * scale);
      const diag = startRender(
        scale,
        wanted,
        scale < wanted * 0.999 ? "budget" : null,
        width * height,
        kind,
      );
      if (kind === "sharp") stat().sharp = diag;
      const d = drawPage(doc, page.drawingId, {
        source: page.source,
        scale,
        width,
        height,
        offsetX: -rect.x * scale,
        offsetY: -rect.y * scale,
      });
      drawing = d;
      d.promise.then(
        ({ canvas }) => {
          endRender(diag, "done");
          done();
          forget();
          if (!canvas) return;
          if (stopped || !host.current) return release(canvas);
          Object.assign(canvas.dataset, {
            x: String(rect.x),
            y: String(rect.y),
            w: String(rect.width),
            h: String(rect.height),
          });
          placeSharpImage(canvas);
          host.current.appendChild(canvas);
          state.current.images.push({ rect, scale, canvas });
          tidy(scale);
          noteKept();
        },
        (error: unknown) => {
          done();
          // Paused for something more urgent: the queue runs it again.
          if (isCancel(error)) return endRender(diag, "cancelled");
          forget();
          endRender(diag, "failed");
          recordError(`Page ${page.number} sharp render failed`, error);
          console.error("Sharp render failed", error);
        },
      );
      return () => d.cancel();
    });
    const job: SharpJob = {
      rect,
      scale,
      stop: () => {
        stopped = true;
        cancelQueued();
        drawing?.cancel();
        forget();
        noteKept();
      },
    };
    s.jobs.push(job);
  }

  useEffect(() => {
    if (!doc || !proxy || !view || !rendered) return;
    const part = visiblePart(page, view.docRect);
    const wanted = view.devicePxPerDocUnit * page.scale;
    if (!part || wanted <= baseScale.current * 1.1) {
      if (!moving) {
        clear();
        stat().sharp = null;
        noteKept();
      }
      return;
    }
    if (moving) {
      if (!drawsInBackground()) stopJobs(() => true);
      return;
    }
    const { rect, scale } = sharpTarget(
      page.size,
      part,
      wanted,
      SHARP_BUDGET / Math.max(1, view.visibleCount),
    );
    // Drawings at another zoom are no use now.
    stopJobs((j) => !sameScale(j.scale, scale));
    const s = state.current;
    const rectsAtScale = () =>
      [...s.images, ...s.jobs]
        .filter((x) => sameScale(x.scale, scale))
        .map((x) => x.rect);
    const timer = window.setTimeout(
      () => {
        if (!coveredBy(part, rectsAtScale()))
          draw(rect, scale, wanted, "sharp");
        if (!drawsInBackground()) return;
        // Ahead, within the memory allowance (images far off make room
        // as new ones land).
        const target = aheadTarget(page.size, part);
        const keep = SHARP_KEEP / Math.max(1, view.visibleCount);
        let committed = [...s.images, ...s.jobs]
          .filter((x) => sameScale(x.scale, scale) && overlaps(x.rect, target))
          .reduce((n, x) => n + pixelsOf(x.rect, x.scale), 0);
        for (const area of aheadAreas(page.size, rect, part)) {
          if (coveredBy(area, rectsAtScale())) continue;
          const px = pixelsOf(area, scale);
          if (committed + px > keep) break;
          committed += px;
          draw(area, scale, wanted, "ahead");
        }
        noteKept();
      },
      drawsInBackground() ? SHARP_DELAY_BACKGROUND_MS : SHARP_DELAY_MS,
    );
    // A pinch stops drawing on the main thread; the next settled view
    // draws again.
    const unregister = registerRender(() => {
      window.clearTimeout(timer);
      if (!drawsInBackground()) stopJobs(() => true);
    });
    return () => {
      window.clearTimeout(timer);
      unregister();
    };
    // The helpers read state through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, proxy, view, moving, rendered, page, registerRender]);

  // Off screen or gone: its sharp images go.
  useEffect(() => {
    if (active) return;
    clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  useEffect(
    () => () => clear(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
}
