/**
 * Burns a drawing page's markup, pins, arrows and notes box into the PDF
 * page, the same size and place as the viewer draws them (SPEC sections 5,
 * 5a and 7).
 */
import {
  BlendMode,
  LineCapStyle,
  LineJoinStyle,
  concatTransformationMatrix,
  setLineJoin,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  type Color,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import { northrop } from "../../brand/northrop";
import type { Item, Markup } from "../../db/types";
import { arrowMetrics, arrowShape } from "../drawings/arrows";
import {
  defaultBoxPosition,
  type BoxStyle,
  type BoxLine,
} from "../drawings/observationBox";
import type { Point } from "../drawings/viewer/viewTransform";
import {
  SHAPE_FILL_OPACITY,
  drawMark,
  isFilled,
  markStyle,
  isHighlight,
} from "../markup/markGeometry";
import { layoutCallout } from "../markup/calloutGeometry";
import { toEncodable } from "../memo/pdf/text";
import { layoutNotesBox, pageView, pinMetrics } from "./markupGeometry";
import type { PagePin } from "./packContents";

export interface MarkupFonts {
  regular: PDFFont;
  bold: PDFFont;
}

export interface PageMarkup {
  /** Every pin on this page (copies included). */
  pins: PagePin[];
  /** Pen and highlighter marks, drawn first (under everything else). */
  marks: Markup[];
  /**
   * The notes box's top-left, normalised on the page, and its own width and
   * text size if changed (null: default spot and size).
   */
  box: (Point & BoxStyle) | null;
  /** From boxLines(): what the notes box says. */
  boxLines: BoxLine[];
}

export function hex(colour: string): Color {
  const n = parseInt(colour.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const RED = hex(northrop.colours.red);
const BLUE = hex(northrop.markup.blue);
const HEADER = hex(northrop.markup.header);
const WHITE = rgb(1, 1, 1);

export const kindColour = (kind: Item["kind"]) =>
  kind === "instruction" ? RED : BLUE;

/** Draws the markup over the page's own content. */
export function drawPageMarkup(
  page: PDFPage,
  markup: PageMarkup,
  fonts: MarkupFonts,
): void {
  const view = pageView(page.getCropBox(), page.getRotation().angle);
  const size = { width: view.width, height: view.height };
  // From here on, draw on the page as shown: origin bottom left, y up.
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(...view.matrix),
  );
  drawMarks(page, markup.marks, size, fonts);
  // A page with only markup has no notes box (it lists the page's pins).
  // A page with pins, or any exported page while there are general notes
  // (more than the header line to list).
  if (markup.pins.length > 0 || markup.boxLines.length > 1)
    drawNotesBox(page, markup, size, fonts);

  for (const item of markup.pins) drawPinArrows(page, item, size);
  for (const item of markup.pins) drawPin(page, item, size, fonts);

  page.pushOperators(popGraphicsState());
}

/** A pin's arrows, each from the pin to its tip (shown-page units, y up). */
export function drawPinArrows(
  page: PDFPage,
  item: PagePin,
  size: { width: number; height: number },
) {
  const am = arrowMetrics(size);
  const colour = kindColour(item.kind);
  for (const arrow of item.arrows) {
    // arrowShape works in y-down page units; flip the result.
    const shape = arrowShape(
      { x: item.x * size.width, y: item.y * size.height },
      { x: arrow.x * size.width, y: arrow.y * size.height },
      size,
    );
    if (!shape) continue;
    const flip = (p: Point) => ({ x: p.x, y: size.height - p.y });
    // Each leg with round caps, so a dog leg's elbow is rounded too.
    const line = shape.line.map(flip);
    line.slice(1).forEach((end, i) =>
      page.drawLine({
        start: line[i],
        end,
        thickness: am.strokeWidth,
        color: colour,
        lineCap: 1,
      }),
    );
    const head = shape.head;
    page.drawSvgPath(
      `M ${head[0].x} ${head[0].y} L ${head[1].x} ${head[1].y} L ${head[2].x} ${head[2].y} Z`,
      { x: 0, y: size.height, color: colour, borderWidth: 0 },
    );
  }
}

/** A pin: its circle and letter (shown-page units, y up). */
export function drawPin(
  page: PDFPage,
  item: PagePin,
  size: { width: number; height: number },
  fonts: MarkupFonts,
) {
  const pm = pinMetrics(size);
  const centre = {
    x: item.x * size.width,
    y: size.height - item.y * size.height,
  };
  page.drawCircle({
    ...centre,
    size: pm.radius,
    color: kindColour(item.kind),
    borderColor: WHITE,
    borderWidth: pm.borderWidth,
  });
  const letter = toEncodable(item.letter, fonts.bold);
  // Two letters (AA...) shrink to fit inside the circle.
  const fontSize = Math.min(
    pm.fontSize,
    (pm.radius * 1.5) / (fonts.bold.widthOfTextAtSize(letter, 1) || 1),
  );
  page.drawText(letter, {
    x: centre.x - fonts.bold.widthOfTextAtSize(letter, fontSize) / 2,
    y: centre.y - fonts.bold.heightAtSize(fontSize, { descender: false }) / 2,
    size: fontSize,
    font: fonts.bold,
    color: WHITE,
  });
}

/** Marks as vector strokes, in the same smoothed shape as the viewer's. */
export function drawMarks(
  page: PDFPage,
  marks: Markup[],
  size: { width: number; height: number },
  fonts: MarkupFonts,
) {
  if (marks.length === 0) return;
  // drawSvgPath sets no line join: round, like the viewer.
  page.pushOperators(pushGraphicsState(), setLineJoin(LineJoinStyle.Round));
  for (const mark of marks) {
    if (mark.tool === "text") {
      drawCallout(page, mark, size, fonts);
      continue;
    }
    const style = markStyle(mark, size);
    const drawing = drawMark(mark, size);
    const colour = hex(style.colour);
    // y-down page units, flipped by drawing from the top-left corner.
    page.drawSvgPath(drawing.d, {
      x: 0,
      y: size.height,
      ...(isFilled(mark, drawing)
        ? { color: colour, opacity: SHAPE_FILL_OPACITY }
        : {}),
      borderColor: colour,
      borderWidth: style.width,
      borderOpacity: style.opacity,
      borderLineCap: LineCapStyle.Round,
      blendMode: isHighlight(mark) ? BlendMode.Multiply : BlendMode.Normal,
    });
    if (drawing.head)
      page.drawSvgPath(drawing.head, {
        x: 0,
        y: size.height,
        color: colour,
        borderWidth: 0,
      });
  }
  page.pushOperators(popGraphicsState());
}

/** A text callout: box, capitals in Helvetica, and its leader. */
function drawCallout(
  page: PDFPage,
  mark: Markup,
  size: { width: number; height: number },
  fonts: MarkupFonts,
) {
  const font = fonts.regular;
  const { box, metrics, lines, leader } = layoutCallout(mark, size, (t, s) =>
    font.widthOfTextAtSize(toEncodable(t, font), s),
  );
  const colour = hex(mark.colour);
  const flip = (y: number) => size.height - y;
  if (leader) {
    // Each leg with round caps, so a dog leg's elbow is rounded too.
    leader.points.slice(1).forEach((to, i) => {
      const from = leader.points[i];
      page.drawLine({
        start: { x: from.x, y: flip(from.y) },
        end: { x: to.x, y: flip(to.y) },
        thickness: leader.width,
        color: colour,
        lineCap: 1,
      });
    });
    const [a, b, c] = leader.head;
    page.drawSvgPath(`M ${a.x} ${a.y} L ${b.x} ${b.y} L ${c.x} ${c.y} Z`, {
      x: 0,
      y: size.height,
      color: colour,
      borderWidth: 0,
    });
  }
  // The border sits inside the box, as in the viewer.
  page.drawRectangle({
    x: box.x + metrics.border / 2,
    y: flip(box.y + box.height) + metrics.border / 2,
    width: box.width - metrics.border,
    height: box.height - metrics.border,
    color: WHITE,
    borderColor: colour,
    borderWidth: metrics.border,
  });
  for (const line of lines) {
    const text = toEncodable(line.text, font);
    if (!text) continue;
    page.drawText(text, {
      x: line.x,
      y: flip(line.baseline),
      size: metrics.fontSize,
      font,
      color: colour,
    });
  }
}

export function drawNotesBox(
  page: PDFPage,
  markup: PageMarkup,
  size: { width: number; height: number },
  fonts: MarkupFonts,
) {
  const font = (bold: boolean) => (bold ? fonts.bold : fonts.regular);
  const layout = layoutNotesBox(
    markup.boxLines,
    size,
    (text, bold, s) =>
      font(bold).widthOfTextAtSize(toEncodable(text, font(bold)), s),
    markup.box ?? {},
  );
  const box = markup.box ?? defaultBoxPosition(size);
  const left = box.x * size.width;
  const top = box.y * size.height;
  const bw = layout.borderWidth;
  // The CSS border sits inside the box; a PDF stroke is centred on its path.
  page.drawRectangle({
    x: left + bw / 2,
    y: size.height - top - layout.height + bw / 2,
    width: layout.width - bw,
    height: layout.height - bw,
    color: WHITE,
    borderColor: BLUE,
    borderWidth: bw,
  });
  for (const line of layout.lines) {
    const f = font(line.bold);
    const text = toEncodable(line.text, f);
    if (!text) continue;
    page.drawText(text, {
      x: left + layout.textLeft,
      y: size.height - top - line.baseline,
      size: layout.fontSize,
      font: f,
      color:
        line.tone === "header"
          ? HEADER
          : line.tone === "instruction"
            ? RED
            : BLUE,
    });
  }
}
