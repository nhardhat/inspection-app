/**
 * Lays out every page of an inspection's drawings as one continuous
 * vertical document (GoodNotes style), with no breaks between drawings:
 * pages are numbered through the whole document. Pure geometry, no
 * rendering.
 *
 * "Document units": every page is scaled to the same width (DOC_WIDTH), so
 * an A4 notes page and an A1 sheet both fill the screen width. A page's
 * own coordinates stay in PDF points; `scale` converts points to document
 * units for that page.
 */
import type { DrawingPage } from "../../../db/types";
import type { Point, Rect, Size } from "../viewer/viewTransform";

export const DOC_WIDTH = 1000;
/** Space between pages, in document units. */
export const PAGE_GAP = 28;

export interface DrawingInput {
  id: string;
  name: string;
  /** [width, height] of each PDF page in points. */
  pageSizes: [number, number][];
  /** The drawing's pages (default: each PDF page once); hidden ones are skipped. */
  pages?: DrawingPage[];
}

export interface PageLayout {
  key: string;
  drawingId: string;
  /**
   * The drawing whose PDF it shows: its own, or another's for a page moved
   * in from there (saved images and drawing use this one).
   */
  pdfDrawingId: string;
  /** 1-based position in the drawing's pages (what items refer to). */
  page: number;
  /** 1-based page of the PDF it shows. */
  source: number;
  /** Pages in the PDF file. */
  pageCount: number;
  /** 1-based page number in the whole document. */
  number: number;
  /** Page size in points. */
  size: Size;
  /** Document units per point for this page. */
  scale: number;
  /** Top of the page in document units. */
  top: number;
  /** Height in document units. */
  height: number;
}

export interface DocumentLayout {
  width: number;
  height: number;
  pages: PageLayout[];
}

export function pageKey(drawingId: string, page: number): string {
  return `${drawingId}:${page}`;
}

export function layoutDocument(drawings: DrawingInput[]): DocumentLayout {
  const pages: PageLayout[] = [];
  const sizesOf = new Map(drawings.map((d) => [d.id, d.pageSizes]));
  let y = 0;
  for (const drawing of drawings) {
    drawingPages(drawing).forEach((entry, i) => {
      const pdfDrawingId = entry.from ?? drawing.id;
      const pdfSizes = sizesOf.get(pdfDrawingId) ?? [];
      const size = pdfSizes[entry.source - 1];
      if (entry.hidden || !size) return;
      const [width, height] = size;
      const scale = DOC_WIDTH / width;
      const docHeight = height * scale;
      pages.push({
        key: pageKey(drawing.id, i + 1),
        drawingId: drawing.id,
        pdfDrawingId,
        page: i + 1,
        source: entry.source,
        pageCount: pdfSizes.length,
        number: pages.length + 1,
        size: { width, height },
        scale,
        top: y,
        height: docHeight,
      });
      y += docHeight + PAGE_GAP;
    });
  }
  return { width: DOC_WIDTH, height: Math.max(0, y - PAGE_GAP), pages };
}

/** A drawing's pages, or each PDF page once for a drawing without the list. */
export function drawingPages(drawing: {
  pages?: DrawingPage[];
  pageSizes?: unknown[];
  pageCount?: number;
}): DrawingPage[] {
  return (
    drawing.pages ??
    Array.from(
      { length: drawing.pageSizes?.length ?? drawing.pageCount ?? 0 },
      (_, i) => ({ source: i + 1 }),
    )
  );
}

/**
 * Each visible page's number through the whole document ("Page 4"), by page
 * key; hidden pages have none.
 */
export function documentPageNumbers(
  drawings: { id: string; pages?: DrawingPage[]; pageCount?: number }[],
): Map<string, number> {
  const numbers = new Map<string, number>();
  for (const drawing of drawings) {
    drawingPages(drawing).forEach((entry, i) => {
      if (!entry.hidden)
        numbers.set(pageKey(drawing.id, i + 1), numbers.size + 1);
    });
  }
  return numbers;
}

/** The page at (or nearest to) a document y, e.g. the centre of the view. */
export function pageAtY(layout: DocumentLayout, y: number): PageLayout | null {
  let best: PageLayout | null = null;
  let bestDistance = Infinity;
  for (const page of layout.pages) {
    const distance =
      y < page.top
        ? page.top - y
        : y > page.top + page.height
          ? y - page.top - page.height
          : 0;
    if (distance < bestDistance) {
      best = page;
      bestDistance = distance;
    }
  }
  return best;
}

/** Normalised position on whichever page contains a document point, if any. */
export function hitPage(
  layout: DocumentLayout,
  p: Point,
): { page: PageLayout; at: Point } | null {
  if (p.x < 0 || p.x > layout.width) return null;
  for (const page of layout.pages) {
    if (p.y >= page.top && p.y <= page.top + page.height) {
      return {
        page,
        at: { x: p.x / layout.width, y: (p.y - page.top) / page.height },
      };
    }
  }
  return null;
}

/** Document point for a normalised position on a page. */
export function pagePointToDoc(page: PageLayout, n: Point): Point {
  return { x: n.x * DOC_WIDTH, y: page.top + n.y * page.height };
}

/** Pages overlapping the document range [top, bottom], plus `margin` either side. */
export function pagesInRange(
  layout: DocumentLayout,
  top: number,
  bottom: number,
  margin = 0,
): PageLayout[] {
  return layout.pages.filter(
    (page) =>
      page.top + page.height >= top - margin && page.top <= bottom + margin,
  );
}

/** The part of a page inside a document rectangle, in that page's points. */
export function visiblePart(page: PageLayout, docRect: Rect): Rect | null {
  const x = Math.max(0, docRect.x);
  const y = Math.max(page.top, docRect.y);
  const right = Math.min(DOC_WIDTH, docRect.x + docRect.width);
  const bottom = Math.min(page.top + page.height, docRect.y + docRect.height);
  if (right <= x || bottom <= y) return null;
  return {
    x: x / page.scale,
    y: (y - page.top) / page.scale,
    width: (right - x) / page.scale,
    height: (bottom - y) / page.scale,
  };
}
