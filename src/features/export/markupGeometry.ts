/**
 * Geometry for burning pins, arrows and the notes box into drawing pages
 * (SPEC section 7). Pure, so it can be unit tested without pdf-lib. Sizes
 * are in page units (PDF points) and scale with the sheet, like the notes
 * box and arrows in the viewer.
 */
import {
  boxMetrics,
  type BoxStyle,
  type BoxLine,
} from "../drawings/observationBox";
import type { Size } from "../drawings/viewer/viewTransform";

export interface PinMetrics {
  radius: number;
  borderWidth: number;
  fontSize: number;
}

/**
 * Pins are 1.6% of the sheet's short side across: about 9.5 mm on A1,
 * 4.8 mm on A3 and 3.4 mm on A4 (engineer decision, 2026-10-04). The
 * viewer's pins stay a fixed size on screen.
 */
export function pinMetrics(page: Size): PinMetrics {
  const radius = Math.min(page.width, page.height) * 0.008;
  return { radius, borderWidth: radius * 0.16, fontSize: radius * 1.15 };
}

/** A rectangle in PDF user space (origin bottom left). */
export interface PdfBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PageView {
  /** The page as shown (as pdf.js and the viewer show it), in points. */
  width: number;
  height: number;
  /**
   * Maps points on the shown page (origin bottom left, y up) into the PDF's
   * own space: [a, b, c, d, e, f] for the `cm` operator.
   */
  matrix: [number, number, number, number, number, number];
}

/** Rotation as pdf.js uses it: a multiple of 90 in 0..270, else 0. */
export function normaliseRotation(angle: number): 0 | 90 | 180 | 270 {
  const a = ((Math.round(angle) % 360) + 360) % 360;
  return a === 90 || a === 180 || a === 270 ? a : 0;
}

/**
 * The page as the viewer shows it. Pins are stored normalised on the shown
 * page, which is the PDF's crop box turned by its /Rotate (clockwise), so a
 * sheet saved rotated or cropped still gets its pins in the right place.
 */
export function pageView(box: PdfBox, rotation: number): PageView {
  const { x, y, width: w, height: h } = box;
  switch (normaliseRotation(rotation)) {
    case 90:
      return { width: h, height: w, matrix: [0, 1, -1, 0, x + w, y] };
    case 180:
      return { width: w, height: h, matrix: [-1, 0, 0, -1, x + w, y + h] };
    case 270:
      return { width: h, height: w, matrix: [0, -1, 1, 0, x, y + h] };
    default:
      return { width: w, height: h, matrix: [1, 0, 0, 1, x, y] };
  }
}

/** Applies a PageView matrix to a point on the shown page (y up). */
export function toPdfSpace(
  view: PageView,
  u: number,
  v: number,
): { x: number; y: number } {
  const [a, b, c, d, e, f] = view.matrix;
  return { x: a * u + c * v + e, y: b * u + d * v + f };
}

/*
 * Arial's line box: the viewer centres text in a line of `lineHeight`, using
 * Arial's ascent and descent (Helvetica has the same widths).
 */
const ASCENT = 0.905;
const DESCENT = 0.212;
/** CSS margin above each heading in the box (0.35em). */
const HEADING_GAP_EM = 0.35;

export interface NotesBoxText {
  text: string;
  bold: boolean;
  tone: BoxLine["tone"];
  /** Baseline, measured down from the top of the box. */
  baseline: number;
}

export interface NotesBoxLayout {
  width: number;
  height: number;
  borderWidth: number;
  fontSize: number;
  /** Where text starts, in from the box's left edge (border + padding). */
  textLeft: number;
  lines: NotesBoxText[];
}

/** Width of `text` at `size` in the box's regular or bold font. */
export type Measure = (text: string, bold: boolean, size: number) => number;

/**
 * Lays out the notes box as the viewer draws it (.observation-box: border
 * and padding inside the width, the header and headings bold, a small gap
 * above each heading), wrapping long lines at spaces.
 */
export function layoutNotesBox(
  lines: BoxLine[],
  page: Size,
  measure: Measure,
  style: BoxStyle = {},
): NotesBoxLayout {
  const m = boxMetrics(page, style);
  const inner = m.width - 2 * (m.padding + m.borderWidth);
  const out: NotesBoxText[] = [];
  let top = m.borderWidth + m.padding;
  for (const line of lines) {
    const bold = line.style !== "item";
    if (line.style === "heading") top += HEADING_GAP_EM * m.fontSize;
    for (const text of wrapWords(line.text, inner, (t) =>
      measure(t, bold, m.fontSize),
    )) {
      out.push({
        text,
        bold,
        tone: line.tone,
        baseline:
          top +
          (m.lineHeight - (ASCENT + DESCENT) * m.fontSize) / 2 +
          ASCENT * m.fontSize,
      });
      top += m.lineHeight;
    }
  }
  return {
    width: m.width,
    height: top + m.padding + m.borderWidth,
    borderWidth: m.borderWidth,
    fontSize: m.fontSize,
    textLeft: m.borderWidth + m.padding,
    lines: out,
  };
}

/** Greedy word wrap; a word wider than the line is split by character. */
export function wrapWords(
  text: string,
  maxWidth: number,
  width: (text: string) => number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (width(candidate) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    let piece = "";
    for (const char of word) {
      if (piece && width(piece + char) > maxWidth) {
        lines.push(piece);
        piece = char;
      } else {
        piece += char;
      }
    }
    line = piece;
  }
  lines.push(line);
  return lines;
}
