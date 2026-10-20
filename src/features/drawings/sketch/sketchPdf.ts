/**
 * Sketch pages (engineer, 2026-10-20; feedback round 1, item 3): a blank
 * sheet with Northrop's calc pad title strip across the top and a light
 * 5 mm grid, as a one-page PDF made here (the drawing PDFs are never
 * changed). The strip is rebuilt from the A4 calc pad (BB-002), at its real
 * size on every sheet, PARTNERS left out, and filled in from the
 * inspection. Pure: fonts and the wordmark are passed in.
 */
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { northrop } from "../../../brand/northrop";

export const SKETCH_SIZES = ["A4", "A3", "A2", "A1"] as const;
export type SketchSize = (typeof SKETCH_SIZES)[number];

export const SKETCH_SCALES = [
  "1:10",
  "1:20",
  "1:50",
  "1:100",
  "1:200",
  "NTS",
] as const;
export type SketchScale = (typeof SKETCH_SCALES)[number];

export type SketchOrientation = "portrait" | "landscape";

/** What a sketch page is: its sheet, scale and number (SK01…). */
export interface SketchSpec {
  size: SketchSize;
  orientation: SketchOrientation;
  scale: SketchScale;
  /** 1 for SK01. */
  number: number;
}

/** Filled in from the inspection. */
export interface SketchFields {
  project: string;
  jobNumber: string;
  /** e.g. "T. Engineer". */
  designed: string;
  /** DD/MM/YYYY. */
  date: string;
}

export interface SketchAssets {
  regular: Uint8Array;
  semiBold: Uint8Array;
  /** The maroon wordmark (PNG). */
  wordmark: Uint8Array;
}

/** Portrait sheet sizes in millimetres. */
const SHEET_MM: Record<SketchSize, [number, number]> = {
  A4: [210, 297],
  A3: [297, 420],
  A2: [420, 594],
  A1: [594, 841],
};

const PT_PER_MM = 72 / 25.4;

/** Its size in points, turned for landscape. */
export function sketchPageSize(
  spec: Pick<SketchSpec, "size" | "orientation">,
): [number, number] {
  const [w, h] = SHEET_MM[spec.size].map((mm) => mm * PT_PER_MM);
  return spec.orientation === "landscape" ? [h, w] : [w, h];
}

/** "SK01". */
export function sketchNumber(n: number): string {
  return `SK${String(n).padStart(2, "0")}`;
}

/*
 * The title strip, in points from the top left, measured from the A4 calc
 * pad; the same real size on every sheet.
 */
const STRIP = {
  height: 127,
  textSize: 9,
  rows: [28, 52, 77, 102],
  /** Label and value columns: left, middle, and REV NO beside SKETCH NO. */
  left: { label: 40, value: 96, width: 140 },
  middle: { label: 241, value: 297, width: 110 },
  revision: { label: 346, value: 384 },
  /** The wordmark's right edge and top, in from the page's top right. */
  wordmark: { right: 13, top: 21, width: 168 },
  rule: 0.75,
};

/** The grid: 5 mm squares, a little darker every 25 mm. */
const GRID = { stepMm: 5, majorEvery: 5, minor: 0.9, major: 0.8 };

const hex = (value: string) => {
  const n = parseInt(value.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

/** Shrinks text to fit `width` (down to 6 pt), then cuts it with "…". */
function fitted(text: string, font: PDFFont, size: number, width: number) {
  let s = size;
  while (s > 6 && font.widthOfTextAtSize(text, s) > width) s -= 0.5;
  let t = text;
  while (t && font.widthOfTextAtSize(t, s) > width)
    t = t.slice(0, -2).trimEnd() + "…";
  return { text: t, size: s };
}

function drawGrid(page: PDFPage, width: number, height: number) {
  const step = GRID.stepMm * PT_PER_MM;
  const shade = (major: boolean) => {
    const v = major ? GRID.major : GRID.minor;
    return rgb(v, v, v);
  };
  const top = height - STRIP.height;
  for (let i = 1; i * step < top; i++) {
    const y = top - i * step;
    const major = i % GRID.majorEvery === 0;
    page.drawLine({
      start: { x: 0, y },
      end: { x: width, y },
      thickness: 0.3,
      color: shade(major),
    });
  }
  for (let i = 1; i * step < width; i++) {
    const x = i * step;
    const major = i % GRID.majorEvery === 0;
    page.drawLine({
      start: { x, y: 0 },
      end: { x, y: top },
      thickness: 0.3,
      color: shade(major),
    });
  }
}

/** Builds the sketch page as a one-page PDF. */
export async function buildSketchPdf(
  spec: SketchSpec,
  fields: SketchFields,
  assets: SketchAssets,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(assets.regular, { subset: true });
  const label = await doc.embedFont(assets.semiBold, { subset: true });
  const wordmark = await doc.embedPng(assets.wordmark);
  const [width, height] = sketchPageSize(spec);
  const page = doc.addPage([width, height]);
  const maroon = hex(northrop.colours.maroon);
  const grey = hex(northrop.colours.grey);
  const L = northrop.sketchLabels;
  const size = STRIP.textSize;

  drawGrid(page, width, height);

  const at = (top: number) => height - top;
  const pair = (
    name: string,
    value: string,
    column: { label: number; value: number; width?: number },
    row: number,
  ) => {
    page.drawText(name, {
      x: column.label,
      y: at(row),
      size,
      font: label,
      color: maroon,
    });
    const fit = fitted(value, regular, size, column.width ?? 60);
    if (fit.text)
      page.drawText(fit.text, {
        x: column.value,
        y: at(row),
        size: fit.size,
        font: regular,
        color: grey,
      });
  };
  const [r1, r2, r3, r4] = STRIP.rows;
  pair(L.project, fields.project, STRIP.left, r1);
  pair(L.scale, spec.scale, STRIP.left, r4);
  pair(L.jobNumber, fields.jobNumber, STRIP.middle, r1);
  pair(L.sketchNumber, sketchNumber(spec.number), STRIP.middle, r2);
  pair(L.revision, "A", { ...STRIP.revision, width: 30 }, r2);
  pair(L.designed, fields.designed, STRIP.middle, r3);
  pair(L.date, fields.date, STRIP.middle, r4);

  const w = STRIP.wordmark.width;
  const h = (w * wordmark.height) / wordmark.width;
  page.drawImage(wordmark, {
    x: width - STRIP.wordmark.right - w,
    y: at(STRIP.wordmark.top) - h,
    width: w,
    height: h,
  });
  page.drawLine({
    start: { x: 0, y: at(STRIP.height) },
    end: { x: width, y: at(STRIP.height) },
    thickness: STRIP.rule,
    color: grey,
  });
  return doc.save();
}
