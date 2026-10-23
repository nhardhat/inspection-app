/**
 * Editable PDF for Bluebeam (spike, feedback round 1 item 7): a drawing
 * page's markup, pins, arrows and notes box as real PDF annotations, so
 * they show in Bluebeam's Markups list and can be moved and edited.
 *
 * Each annotation's look (its appearance stream) is drawn by the same code
 * that burns markup into the normal export (drawMarkup.ts), onto a scratch
 * page that becomes the annotation's form XObject, so it looks the same in
 * any viewer until it's edited. The annotation's own geometry (InkList,
 * Vertices, L, CL...) is what Bluebeam uses when it redraws one.
 */
import {
  PDFArray,
  PDFContentStream,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFPage,
  PDFRef,
  PDFString,
  type PDFDocument,
} from "pdf-lib";
import { northrop } from "../../../brand/northrop";
import type { Markup } from "../../../db/types";
import { arrowShape } from "../../drawings/arrows";
import { defaultBoxPosition } from "../../drawings/observationBox";
import type { Point } from "../../drawings/viewer/viewTransform";
import { layoutCallout } from "../../markup/calloutGeometry";
import {
  drawMark,
  isFilled,
  isHighlight,
  markStyle,
  rotatePoint,
  boxCentre,
  toPagePoints,
} from "../../markup/markGeometry";
import { toEncodable } from "../../memo/pdf/text";
import {
  drawMarks,
  drawNotesBox,
  drawPin,
  drawPinArrows,
  type MarkupFonts,
  type PageMarkup,
} from "../drawMarkup";
import {
  layoutNotesBox,
  pageView,
  pinMetrics,
  type PageView,
} from "../markupGeometry";
import type { PagePin } from "../packContents";

type Size = { width: number; height: number };

interface Ctx {
  doc: PDFDocument;
  page: PDFPage;
  view: PageView;
  size: Size;
  author: string;
  fonts: MarkupFonts;
  now: Date;
}

const rgbOf = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const KIND_HEX = {
  instruction: northrop.colours.red,
  observation: northrop.markup.blue,
} as const;

/** A shown-page point (y down) in the PDF's own space. */
function toPdf(ctx: Ctx, p: Point): [number, number] {
  const x = p.x;
  const y = ctx.size.height - p.y;
  const [a, b, c, d, e, f] = ctx.view.matrix;
  return [a * x + c * y + e, b * x + d * y + f];
}

const flat = (ctx: Ctx, points: Point[]) =>
  points.flatMap((p) => toPdf(ctx, p));

/** Every coordinate pair in path data (M, L, C and Z only). */
function pathPoints(d: string | null): Point[] {
  if (!d) return [];
  const n = d
    .split(/[\sMLCZ]+/)
    .filter(Boolean)
    .map(Number);
  const out: Point[] = [];
  for (let i = 0; i + 1 < n.length; i += 2) out.push({ x: n[i], y: n[i + 1] });
  return out;
}

/**
 * The bounds of `points` (shown page, y down) plus `pad`: the appearance's
 * BBox (shown page, y up) and the annotation's Rect (PDF space).
 */
function bounds(ctx: Ctx, points: Point[], pad: number) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => ctx.size.height - p.y);
  const bbox = [
    Math.min(...xs) - pad,
    Math.min(...ys) - pad,
    Math.max(...xs) + pad,
    Math.max(...ys) + pad,
  ];
  const [a, b, c, d, e, f] = ctx.view.matrix;
  const corners = [
    [bbox[0], bbox[1]],
    [bbox[2], bbox[1]],
    [bbox[2], bbox[3]],
    [bbox[0], bbox[3]],
  ].map(([x, y]) => [a * x + c * y + e, b * x + d * y + f]);
  const rect = [
    Math.min(...corners.map((p) => p[0])),
    Math.min(...corners.map((p) => p[1])),
    Math.max(...corners.map((p) => p[0])),
    Math.max(...corners.map((p) => p[1])),
  ];
  return { bbox, rect };
}

/**
 * An appearance stream: `draw` paints on a scratch page the size of the
 * shown page (y up), which becomes a form XObject clipped to `bbox`.
 */
function appearance(
  ctx: Ctx,
  bbox: number[],
  draw: (page: PDFPage) => void,
): PDFRef {
  const scratch = PDFPage.create(ctx.doc);
  scratch.setSize(ctx.size.width, ctx.size.height);
  draw(scratch);
  const contents = scratch.node.Contents();
  const ref =
    contents instanceof PDFArray
      ? contents.get(0)
      : scratch.node.get(PDFName.of("Contents"));
  if (!(ref instanceof PDFRef)) throw new Error("No appearance drawn");
  const stream = ctx.doc.context.lookup(ref) as PDFContentStream;
  stream.dict.set(PDFName.of("Type"), PDFName.of("XObject"));
  stream.dict.set(PDFName.of("Subtype"), PDFName.of("Form"));
  stream.dict.set(PDFName.of("BBox"), ctx.doc.context.obj(bbox));
  stream.dict.set(PDFName.of("Matrix"), ctx.doc.context.obj(ctx.view.matrix));
  stream.dict.set(PDFName.of("Resources"), scratch.node.Resources()!);
  ctx.doc.context.delete(scratch.ref);
  return ref;
}

interface AnnotSpec {
  subtype: string;
  subject: string;
  rect: number[];
  ap: PDFRef;
  colour: string;
  width?: number;
  contents?: string;
  /** Group with this annotation (moves with it in Bluebeam, we hope). */
  groupWith?: PDFRef;
  extra?: Record<string, unknown>;
}

let serial = 0;

function addAnnot(ctx: Ctx, spec: AnnotSpec): PDFRef {
  const { context } = ctx.doc;
  const dict = context.obj({
    Type: "Annot",
    Subtype: spec.subtype,
    Rect: spec.rect,
    NM: PDFString.of(`hardhat-${Date.now().toString(36)}-${(serial += 1)}`),
    T: PDFHexString.fromText(ctx.author),
    Subj: PDFHexString.fromText(spec.subject),
    M: PDFString.fromDate(ctx.now),
    CreationDate: PDFString.fromDate(ctx.now),
    F: 4,
    C: rgbOf(spec.colour),
    P: ctx.page.ref,
    AP: { N: spec.ap },
    ...(spec.width !== undefined
      ? { BS: { Type: "Border", W: spec.width, S: "S" } }
      : {}),
    ...(spec.extra ?? {}),
  }) as PDFDict;
  if (spec.contents !== undefined)
    dict.set(PDFName.of("Contents"), PDFHexString.fromText(spec.contents));
  if (spec.groupWith) {
    dict.set(PDFName.of("IRT"), spec.groupWith);
    dict.set(PDFName.of("RT"), PDFName.of("Group"));
  }
  const ref = context.register(dict);
  ctx.page.node.addAnnot(ref);
  return ref;
}

const SUBJECTS: Record<Markup["tool"], string> = {
  pen: "Pen",
  highlighter: "Highlighter",
  line: "Line",
  arrow: "Arrow",
  rect: "Rectangle",
  ellipse: "Ellipse",
  cloud: "Cloud",
  polygon: "Polygon",
  oval: "Oval",
  text: "Callout",
};

function annotateMark(ctx: Ctx, mark: Markup) {
  if (mark.tool === "text") return annotateCallout(ctx, mark);
  const { size } = ctx;
  const style = markStyle(mark, size);
  const drawing = drawMark(mark, size);
  const pts = [...pathPoints(drawing.d), ...pathPoints(drawing.head)];
  if (pts.length === 0) return;
  const { bbox, rect } = bounds(ctx, pts, style.width / 2 + 1);
  const ap = appearance(ctx, bbox, (p) =>
    drawMarks(p, [mark], size, ctx.fonts),
  );
  const subject = isHighlight(mark)
    ? `Highlight ${SUBJECTS[mark.tool].toLowerCase()}`
    : SUBJECTS[mark.tool];
  const base = { subject, rect, ap, colour: style.colour, width: style.width };
  const fill = isFilled(mark, drawing) ? { IC: rgbOf(style.colour) } : {};
  const highlight = isHighlight(mark)
    ? { CA: style.opacity, BM: "Multiply" }
    : {};
  const page = toPagePoints(mark.points, size);
  // A turned box shape's corners.
  const corners = () => {
    const [a, b] = [page[0], page[page.length - 1]];
    const level = [
      { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) },
      { x: Math.max(a.x, b.x), y: Math.min(a.y, b.y) },
      { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) },
      { x: Math.min(a.x, b.x), y: Math.max(a.y, b.y) },
    ];
    const c = boxCentre(page);
    return level.map((p) => rotatePoint(p, c, mark.rotation ?? 0));
  };
  switch (mark.tool) {
    case "pen":
    case "highlighter":
      addAnnot(ctx, {
        ...base,
        subtype: "Ink",
        extra: { InkList: [flat(ctx, drawing.outline)], ...highlight },
      });
      return;
    case "line":
    case "arrow":
      addAnnot(ctx, {
        ...base,
        subtype: "Line",
        extra: {
          L: flat(ctx, [page[0], page[page.length - 1]]),
          LE: ["None", mark.tool === "arrow" ? "ClosedArrow" : "None"],
          IC: rgbOf(style.colour),
          ...highlight,
        },
      });
      return;
    case "rect":
    case "ellipse":
      if (!mark.rotation) {
        addAnnot(ctx, {
          ...base,
          subtype: mark.tool === "rect" ? "Square" : "Circle",
          extra: { ...fill, ...highlight },
        });
        return;
      }
      addAnnot(ctx, {
        ...base,
        subtype: "Polygon",
        extra: {
          Vertices: flat(
            ctx,
            mark.tool === "rect" ? corners() : drawing.outline.slice(0, -1),
          ),
          ...fill,
          ...highlight,
        },
      });
      return;
    case "cloud":
      addAnnot(ctx, {
        ...base,
        subtype: "Polygon",
        extra: {
          Vertices: flat(ctx, corners()),
          BE: { S: "C", I: 1 },
          IT: "PolygonCloud",
          ...fill,
          ...highlight,
        },
      });
      return;
    case "polygon":
    case "oval":
      addAnnot(ctx, {
        ...base,
        subtype: "Polygon",
        extra: {
          Vertices: flat(
            ctx,
            mark.tool === "polygon" ? page : drawing.outline.slice(0, -1),
          ),
          ...fill,
          ...highlight,
        },
      });
      return;
  }
}

function annotateCallout(ctx: Ctx, mark: Markup) {
  const { size, fonts } = ctx;
  const font = fonts.regular;
  const { box, metrics, leader } = layoutCallout(mark, size, (t, s) =>
    font.widthOfTextAtSize(toEncodable(t, font), s),
  );
  const corners = [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
  ];
  const pts = [
    ...corners,
    ...(leader ? [...leader.points, ...leader.head] : []),
  ];
  const { bbox, rect } = bounds(ctx, pts, metrics.border);
  const ap = appearance(ctx, bbox, (p) => drawMarks(p, [mark], size, fonts));
  // The text box inside Rect: left, bottom, right, top insets.
  const inner = bounds(ctx, corners, 0).rect;
  const rd = [
    inner[0] - rect[0],
    inner[1] - rect[1],
    rect[2] - inner[2],
    rect[3] - inner[3],
  ];
  const [r, g, b] = rgbOf(mark.colour);
  const fs = metrics.fontSize.toFixed(2);
  addAnnot(ctx, {
    subtype: "FreeText",
    subject: "Callout",
    rect,
    ap,
    colour: mark.colour,
    width: metrics.border,
    contents: mark.text ?? "",
    extra: {
      DA: PDFString.of(`/Helv ${fs} Tf ${r} ${g} ${b} rg`),
      DS: PDFString.of(
        `font: Helvetica ${fs}pt; text-align:left; color:${mark.colour}`,
      ),
      IC: [1, 1, 1],
      RD: rd,
      ...(leader
        ? {
            IT: "FreeTextCallout",
            // Tip, elbow, then where it leaves the box.
            CL: flat(ctx, [
              leader.head[0],
              ...(leader.points.length > 2 ? [leader.points[1]] : []),
              leader.points[0],
            ]),
            LE: "ClosedArrow",
          }
        : {}),
    },
  });
}

function annotateNotesBox(ctx: Ctx, markup: PageMarkup) {
  const { size, fonts } = ctx;
  const font = (bold: boolean) => (bold ? fonts.bold : fonts.regular);
  const layout = layoutNotesBox(
    markup.boxLines,
    size,
    (text, bold, s) =>
      font(bold).widthOfTextAtSize(toEncodable(text, font(bold)), s),
    markup.box ?? {},
  );
  const at = markup.box ?? defaultBoxPosition(size);
  const left = at.x * size.width;
  const top = at.y * size.height;
  const { bbox, rect } = bounds(
    ctx,
    [
      { x: left, y: top },
      { x: left + layout.width, y: top + layout.height },
    ],
    0,
  );
  const ap = appearance(ctx, bbox, (p) => drawNotesBox(p, markup, size, fonts));
  const colour = (tone: string) =>
    tone === "header"
      ? northrop.markup.header
      : tone === "instruction"
        ? northrop.colours.red
        : northrop.markup.blue;
  const escape = (t: string) =>
    t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const fs = layout.fontSize.toFixed(2);
  // Rich text keeps each line's colour and weight if Bluebeam redraws it.
  const rc =
    `<?xml version="1.0"?><body xmlns="http://www.w3.org/1999/xhtml" xmlns:xfa="http://www.xfa.org/schema/xfa-data/1.0/" xfa:APIVersion="Acrobat:11.0.0" xfa:spec="2.0.2" style="font-size:${fs}pt;font-family:Helvetica">` +
    markup.boxLines
      .map(
        (l) =>
          `<p style="color:${colour(l.tone)};font-weight:${l.style === "item" ? "normal" : "bold"}">${escape(l.text)}</p>`,
      )
      .join("") +
    "</body>";
  addAnnot(ctx, {
    subtype: "FreeText",
    subject: "Notes box",
    rect,
    ap,
    colour: northrop.markup.blue,
    width: layout.borderWidth,
    contents: markup.boxLines.map((l) => l.text).join("\n"),
    extra: {
      DA: PDFString.of(`/Helv ${fs} Tf 0 0 0 rg`),
      DS: PDFString.of(`font: Helvetica ${fs}pt; text-align:left`),
      RC: PDFHexString.fromText(rc),
      IC: [1, 1, 1],
    },
  });
}

/**
 * A pin and its arrows, grouped. Spike: instruction pins are Circle
 * annotations, observation pins Stamps, to see which Bluebeam handles better.
 */
function annotatePin(ctx: Ctx, item: PagePin) {
  const { size, fonts } = ctx;
  const pm = pinMetrics(size);
  const centre = { x: item.x * size.width, y: item.y * size.height };
  const { bbox, rect } = bounds(ctx, [centre], pm.radius + pm.borderWidth);
  const ap = appearance(ctx, bbox, (p) => drawPin(p, item, size, fonts));
  const name = `${item.kind === "instruction" ? "Instruction" : "Observation"} ${item.letter}`;
  const pin =
    item.kind === "instruction"
      ? addAnnot(ctx, {
          subtype: "Circle",
          subject: "Pin",
          rect,
          ap,
          colour: "#ffffff",
          width: pm.borderWidth,
          contents: name,
          extra: { IC: rgbOf(KIND_HEX.instruction) },
        })
      : addAnnot(ctx, {
          subtype: "Stamp",
          subject: "Pin",
          rect,
          ap,
          colour: KIND_HEX.observation,
          contents: name,
          extra: { Name: "Pin" },
        });
  const am = { width: Math.min(size.width, size.height) * 0.0025 };
  for (const arrow of item.arrows) {
    const tip = { x: arrow.x * size.width, y: arrow.y * size.height };
    const shape = arrowShape(centre, tip, size);
    if (!shape) continue;
    const one = { ...item, arrows: [arrow] };
    const a = bounds(ctx, [...shape.line, ...shape.head], am.width);
    const arrowAp = appearance(ctx, a.bbox, (p) => drawPinArrows(p, one, size));
    const colour = KIND_HEX[item.kind];
    const ends = { LE: ["None", "ClosedArrow"], IC: rgbOf(colour) };
    const elbow = shape.line.length > 2 ? [shape.line[1]] : [];
    addAnnot(ctx, {
      subtype: elbow.length ? "PolyLine" : "Line",
      subject: "Pin arrow",
      rect: a.rect,
      ap: arrowAp,
      colour,
      width: am.width,
      contents: name,
      groupWith: pin,
      extra: elbow.length
        ? { Vertices: flat(ctx, [centre, ...elbow, tip]), ...ends }
        : { L: flat(ctx, [centre, tip]), ...ends },
    });
  }
}

/**
 * The editable counterpart of drawPageMarkup: the same marks, notes box,
 * arrows and pins, as annotations, in the same stacking order.
 */
export function annotatePageMarkup(
  page: PDFPage,
  markup: PageMarkup,
  fonts: MarkupFonts,
  author: string,
): void {
  const view = pageView(page.getCropBox(), page.getRotation().angle);
  const ctx: Ctx = {
    doc: page.doc,
    page,
    view,
    size: { width: view.width, height: view.height },
    author: author || northrop.name,
    fonts,
    now: new Date(),
  };
  for (const mark of markup.marks) annotateMark(ctx, mark);
  if (markup.pins.length > 0 || markup.boxLines.length > 1)
    annotateNotesBox(ctx, markup);
  for (const item of markup.pins) annotatePin(ctx, item);
}
