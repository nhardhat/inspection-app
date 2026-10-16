/**
 * The export pack's marked-up drawing pages (SPEC section 7): every page
 * with pins or markup, in document order, each the original PDF page at its
 * own size with the markup, pins, arrows and notes box burned in. Hidden
 * pages are left out; a duplicated page with pins exports as its own page.
 */
import { PDFDocument } from "pdf-lib";
import type { Drawing, Item, ObservationBox } from "../../db/types";
import { boxLines } from "../drawings/observationBox";
import { drawPageMarkup, type MarkupFonts } from "./drawMarkup";
import type { PinnedPage } from "./packContents";

export interface DrawingPagesInput {
  pages: PinnedPage[];
  /** General notes (no pin): every exported page's notes box lists them. */
  generalNotes?: Item[];
  boxes: ObservationBox[];
  /** boxHeader() for the inspection. */
  header: string;
  /** The notes box's observations heading (a heading snippet). */
  observationHeading: string;
  /** A drawing's PDF bytes (loaded one drawing at a time). */
  loadPdf: (drawing: Drawing) => Promise<Uint8Array>;
  /** Called after each page is added. */
  onPage?: (done: number, total: number) => void;
}

/** Thrown when a drawing's PDF can't be read for the pack. */
export class DrawingReadError extends Error {
  readonly drawingName: string;
  constructor(drawingName: string, cause: unknown) {
    super(`Couldn't read the drawing "${drawingName}"`, { cause });
    this.drawingName = drawingName;
  }
}

/** Appends the pinned pages to `doc`. Returns how many were added. */
export async function appendDrawingPages(
  doc: PDFDocument,
  input: DrawingPagesInput,
  fonts: MarkupFonts,
): Promise<number> {
  const total = input.pages.length;
  let done = 0;
  // Runs of pages from one PDF, keeping document order, so each PDF is
  // opened once per run (a page moved in from another drawing shows that
  // drawing's PDF).
  const byPdf: PinnedPage[][] = [];
  for (const page of input.pages) {
    const last = byPdf[byPdf.length - 1];
    if (last && last[0].pdfDrawing.id === page.pdfDrawing.id) last.push(page);
    else byPdf.push([page]);
  }
  for (const group of byPdf) {
    const pdfDrawing = group[0].pdfDrawing;
    let source: PDFDocument;
    try {
      source = await PDFDocument.load(await input.loadPdf(pdfDrawing), {
        ignoreEncryption: true,
        updateMetadata: false,
      });
    } catch (e) {
      throw new DrawingReadError(pdfDrawing.name, e);
    }
    const copied = await doc.copyPages(
      source,
      group.map((p) => p.source - 1),
    );
    group.forEach((pinned, i) => {
      const page = doc.addPage(copied[i]);
      const box = input.boxes.find(
        (b) => b.drawingId === pinned.drawing.id && b.page === pinned.position,
      );
      drawPageMarkup(
        page,
        {
          pins: pinned.pins,
          marks: pinned.marks,
          box: box ? { x: box.x, y: box.y } : null,
          boxLines: boxLines({
            header: input.header,
            observationHeading: input.observationHeading,
            items: [...(input.generalNotes ?? []), ...pinned.items],
          }),
        },
        fonts,
      );
      done += 1;
      input.onPage?.(done, total);
    });
  }
  return done;
}
