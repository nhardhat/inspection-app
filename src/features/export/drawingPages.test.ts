import { PDFDocument, StandardFonts } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { beforeAll, describe, expect, test } from "vitest";
import type { Drawing, Item, Markup } from "../../db/types";
import {
  SHEET_SIZES,
  buildSyntheticDrawing,
} from "../drawings/fixtures/syntheticDrawing";
import { appendDrawingPages } from "./drawingPages";
import { pinnedPages } from "./packContents";

let pdf: Uint8Array;

beforeAll(async () => {
  pdf = await buildSyntheticDrawing([
    { size: "A1", number: "S-101", title: "LEVEL 3 SLAB PLAN" },
    { size: "A3", number: "S-501", title: "TYPICAL DETAILS" },
    { size: "A4", number: "S-001", title: "GENERAL NOTES" },
  ]);
});

const drawing = (id: string, pages: Drawing["pages"]): Drawing => ({
  id,
  inspectionId: "i1",
  name: id,
  pdfBlobId: "b",
  pageCount: 3,
  pages,
  fileSize: 0,
  createdAt: 0,
});

const item = (over: Partial<Item>): Item => ({
  id: crypto.randomUUID(),
  inspectionId: "i1",
  letter: "A",
  kind: "instruction",
  drawingId: "d1",
  page: 1,
  x: 0.3,
  y: 0.4,
  text: "Add bar",
  requiresPhotoConfirmation: false,
  photoIds: [],
  createdAt: 0,
  sequence: 0,
  arrows: [],
  ...over,
});

async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const texts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    texts.push(
      content.items.map((it) => ("str" in it ? it.str : "")).join(" "),
    );
  }
  await doc.loadingTask.destroy();
  return texts;
}

describe("pinnedPages", () => {
  test("only pages with pins, in document order, hidden pages left out", () => {
    const d1 = drawing("d1", [
      { source: 1 },
      { source: 2 },
      { source: 2 },
      { source: 3, hidden: true },
    ]);
    const d2 = drawing("d2", [{ source: 1 }]);
    const items = [
      item({ drawingId: "d2", page: 1, letter: "C" }),
      item({ drawingId: "d1", page: 3, letter: "B" }),
      item({ drawingId: "d1", page: 1, letter: "A", kind: "observation" }),
      item({ drawingId: "d1", page: 1, letter: "A" }),
      item({ drawingId: "d1", page: 4, letter: "D" }),
    ];
    const pages = pinnedPages([d1, d2], items);
    expect(pages.map((p) => [p.drawing.id, p.position, p.source])).toEqual([
      ["d1", 1, 1],
      ["d1", 3, 2],
      ["d2", 1, 1],
    ]);
    expect(pages[0].items.map((i) => `${i.kind[0]}${i.letter}`)).toEqual([
      "oA",
      "iA",
    ]);
  });
});

describe("pinnedPages with a page moved in from another drawing", () => {
  test("it goes in among its new drawing's pages, from its own PDF", () => {
    const d1 = drawing("d1", [{ source: 1 }]);
    const d2 = drawing("d2", [{ source: 1 }, { source: 3, from: "d1" }]);
    const items = [
      item({ drawingId: "d2", page: 2, letter: "B" }),
      item({ drawingId: "d1", page: 1, letter: "A" }),
    ];
    const pages = pinnedPages([d1, d2], items);
    expect(
      pages.map((p) => [p.drawing.id, p.position, p.pdfDrawing.id, p.source]),
    ).toEqual([
      ["d1", 1, "d1", 1],
      ["d2", 2, "d1", 3],
    ]);
  });
});

describe("pinnedPages with general notes", () => {
  test("a general note (no pin) adds no pages: only pages with pins or markup go in", () => {
    const d1 = drawing("d1", [{ source: 1 }, { source: 2 }, { source: 3 }]);
    const items = [
      item({ drawingId: "d1", page: 2, letter: "B", kind: "observation" }),
      item({
        drawingId: "",
        page: 0,
        letter: "A",
        kind: "observation",
        general: true,
      }),
    ];
    const pages = pinnedPages([d1], items);
    expect(pages.map((p) => p.position)).toEqual([2]);
    // The page's own items; the general notes join its box when drawn.
    expect(pages[0].items.map((i) => i.letter)).toEqual(["B"]);
  });
});

describe("pinnedPages with copies", () => {
  test("a page with only a copy goes in, with the item's letter and the copy's arrows", () => {
    const d1 = drawing("d1", [{ source: 1 }, { source: 2 }]);
    const a = item({
      drawingId: "d1",
      page: 1,
      letter: "A",
      copies: [
        {
          id: "c1",
          drawingId: "d1",
          page: 2,
          x: 0.7,
          y: 0.2,
          arrows: [{ id: "t", x: 0.8, y: 0.3 }],
        },
      ],
    });
    const pages = pinnedPages([d1], [a]);
    expect(pages.map((p) => p.position)).toEqual([1, 2]);
    expect(pages[1].items.map((i) => i.id)).toEqual([a.id]);
    expect(pages[1].pins).toEqual([
      {
        kind: "instruction",
        letter: "A",
        x: 0.7,
        y: 0.2,
        arrows: [{ id: "t", x: 0.8, y: 0.3 }],
      },
    ]);
  });
});

describe("appendDrawingPages", () => {
  test("copies each pinned page at its own size with the markup burned in", async () => {
    const d1 = drawing("d1", [{ source: 1 }, { source: 2 }, { source: 2 }]);
    const items = [
      item({
        page: 1,
        letter: "A",
        text: "Add N12 bar",
        arrows: [{ id: "a", x: 0.5, y: 0.6 }],
      }),
      item({
        page: 1,
        letter: "A",
        kind: "observation",
        text: "Existing crack",
      }),
      item({ page: 3, letter: "B", text: "Increase cover" }),
    ];
    const doc = await PDFDocument.create();
    const fonts = {
      regular: await doc.embedFont(StandardFonts.Helvetica),
      bold: await doc.embedFont(StandardFonts.HelveticaBold),
    };
    const progress: number[] = [];
    const added = await appendDrawingPages(
      doc,
      {
        pages: pinnedPages([d1], items),
        boxes: [{ id: "b1", drawingId: "d1", page: 1, x: 0.1, y: 0.1 }],
        header: "NORTHROP INSPECTION | SLAB | T. ENGINEER | 01/10/2026",
        observationHeading: "Noted for information:",
        loadPdf: async () => pdf,
        onPage: (done) => progress.push(done),
      },
      fonts,
    );
    expect(added).toBe(2);
    expect(progress).toEqual([1, 2]);
    const sizes = doc.getPages().map((p) => {
      const { width, height } = p.getSize();
      return [Math.round(width), Math.round(height)];
    });
    expect(sizes).toEqual([
      SHEET_SIZES.A1.map(Math.round),
      SHEET_SIZES.A3.map(Math.round),
    ]);

    const texts = await pageTexts(await doc.save());
    expect(texts[0]).toContain("S-101");
    expect(texts[0]).toContain("NOTED FOR INFORMATION:");
    expect(texts[0]).toContain("A. EXISTING CRACK");
    expect(texts[0]).toContain("A. ADD N12 BAR");
    // The duplicate shows source page 2 with its own pin.
    expect(texts[1]).toContain("S-501");
    expect(texts[1]).toContain("B. INCREASE COVER");
    expect(texts[1]).not.toContain("EXISTING CRACK");
  });

  test("a page with only markup goes in, without a notes box", async () => {
    const d1 = drawing("d1", [{ source: 1 }, { source: 2 }, { source: 3 }]);
    const mark = (over: Partial<Markup>): Markup => ({
      id: crypto.randomUUID(),
      inspectionId: "i1",
      drawingId: "d1",
      page: 2,
      tool: "pen",
      points: [0.1, 0.1, 0.3, 0.2, 0.5, 0.1],
      colour: "#DA1A32",
      weight: 0.0025,
      createdAt: 1,
      ...over,
    });
    const marks = [
      mark({}),
      mark({ tool: "highlighter", colour: "#FFD400", weight: 0.012 }),
      // Shapes: two corners each.
      mark({ tool: "cloud", points: [0.2, 0.2, 0.5, 0.4] }),
      mark({ tool: "arrow", points: [0.6, 0.6, 0.8, 0.5] }),
      mark({ tool: "rect", points: [0.1, 0.6, 0.3, 0.8], fill: false }),
      // A text callout: box x, y, w, h, then the leader's tip.
      mark({
        tool: "text",
        points: [0.5, 0.7, 0.2, 0.05, 0.4, 0.6],
        weight: 0.012,
        text: "LAP 600 MIN",
      }),
    ];
    const pages = pinnedPages([d1], [item({ page: 1 })], marks);
    expect(pages.map((p) => [p.position, p.marks.length])).toEqual([
      [1, 0],
      [2, 6],
    ]);
    const doc = await PDFDocument.create();
    const fonts = {
      regular: await doc.embedFont(StandardFonts.Helvetica),
      bold: await doc.embedFont(StandardFonts.HelveticaBold),
    };
    await appendDrawingPages(
      doc,
      {
        pages,
        boxes: [],
        header: "NORTHROP INSPECTION | SLAB | T. ENGINEER | 01/10/2026",
        observationHeading: "Noted for information:",
        loadPdf: async () => pdf,
      },
      fonts,
    );
    const bytes = await doc.save({ useObjectStreams: false });
    const texts = await pageTexts(bytes);
    expect(texts[0]).toContain("NORTHROP INSPECTION");
    expect(texts[1]).toContain("S-501");
    expect(texts[1]).not.toContain("NORTHROP INSPECTION");
    expect(texts[1]).toContain("LAP 600 MIN");
    // The highlighter is see-through, multiplied over the drawing.
    expect(new TextDecoder("latin1").decode(bytes)).toContain("/Multiply");
  });

  test("names the drawing when its PDF can't be read", async () => {
    const doc = await PDFDocument.create();
    const fonts = {
      regular: await doc.embedFont(StandardFonts.Helvetica),
      bold: await doc.embedFont(StandardFonts.HelveticaBold),
    };
    await expect(
      appendDrawingPages(
        doc,
        {
          pages: pinnedPages(
            [drawing("Broken", [{ source: 1 }])],
            [item({ drawingId: "Broken" })],
          ),
          boxes: [],
          header: "H",
          observationHeading: "N:",
          loadPdf: async () => new Uint8Array([1, 2, 3]),
        },
        fonts,
      ),
    ).rejects.toThrow('Couldn\'t read the drawing "Broken"');
  });
});
