/**
 * The picture a pinch moves. Moving the real document while fingers are
 * down is slow on iPad Safari: zoomed in, the document is laid out many
 * times the screen size and every frame of a pinch makes Safari rework
 * those huge layers (measured at 80 ms a frame on a real iPad). Instead, a
 * pinch draws one screen-sized snapshot of what is on screen (the pages'
 * existing canvases, arrows, notes boxes and pins) and scales only that;
 * the document underneath stays still, is laid out once when the fingers
 * lift, and the snapshot goes once the pages have redrawn.
 *
 * Two canvases: the view itself at device resolution, and a softer one
 * three views wide and high behind it, so zooming out shows the
 * surroundings (beyond that, the viewer background).
 */
import { northrop } from "../../../brand/northrop";
import { arrowMetrics, arrowShape } from "../arrows";
import {
  pageToScreen,
  type Point,
  type Size,
  type ViewTransform,
} from "../viewer/viewTransform";
import {
  SHAPE_FILL_OPACITY,
  drawMark,
  isFilled,
  markStyle,
  isHighlight,
} from "../../markup/markGeometry";
import { layoutCallout } from "../../markup/calloutGeometry";
import { measureArial } from "../../markup/measureText";
import type { DocMark } from "../../markup/tools";
import type { DocPin } from "./DocumentViewer";
import { DOC_WIDTH, pagePointToDoc, type PageLayout } from "./documentLayout";

/** Pixel budgets: the sharp view, and the soft surroundings. */
const VIEW_PIXELS = 6_000_000;
const SURROUND_PIXELS = 3_000_000;
const PIN_RADIUS = 16;

export interface SnapshotSource {
  /** The viewer's size (CSS px). */
  view: Size;
  /** The view being captured (screen = doc * scale + offset). */
  transform: ViewTransform;
  pages: PageLayout[];
  pins: DocPin[];
  /** Pen and highlighter marks (drawn over the pages, under everything else). */
  marks: DocMark[];
  /** The viewer element: page canvases and notes boxes are read from it. */
  container: HTMLElement;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function overlaps(a: Rect, b: Rect) {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

export class PinchSnapshot {
  private readonly layer: HTMLDivElement;
  private readonly viewCanvas: HTMLCanvasElement;
  private readonly surroundCanvas: HTMLCanvasElement;
  private captured: ViewTransform | null = null;
  private readonly host: HTMLElement;

  constructor(host: HTMLElement) {
    this.host = host;
    this.layer = document.createElement("div");
    this.layer.className = "viewer-snapshot-layer";
    this.surroundCanvas = document.createElement("canvas");
    this.viewCanvas = document.createElement("canvas");
    this.layer.append(this.surroundCanvas, this.viewCanvas);
    host.append(this.layer);
  }

  get shown() {
    return this.captured !== null;
  }

  /** Draws the current view and shows it in place of the document. */
  capture(src: SnapshotSource) {
    const { width: w, height: h } = src.view;
    if (w <= 0 || h <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const viewScale = Math.min(dpr, Math.sqrt(VIEW_PIXELS / (w * h)));
    const surroundScale = Math.min(
      0.5,
      Math.sqrt(SURROUND_PIXELS / (9 * w * h)),
    );
    const background = getComputedStyle(src.container).backgroundColor;

    size(this.viewCanvas, w, h, viewScale, 0, 0);
    size(this.surroundCanvas, 3 * w, 3 * h, surroundScale, -w, -h);
    draw(
      this.surroundCanvas,
      surroundScale,
      { x: -w, y: -h, width: 3 * w, height: 3 * h },
      src,
      background,
    );
    draw(
      this.viewCanvas,
      viewScale,
      { x: 0, y: 0, width: w, height: h },
      src,
      background,
    );

    this.captured = src.transform;
    this.move(src.transform);
    this.host.dataset.on = "";
  }

  /** Shows the snapshot as the view `to` would show the captured content. */
  move(to: ViewTransform) {
    const from = this.captured;
    if (!from) return;
    const k = to.scale / from.scale;
    const x = to.x - k * from.x;
    const y = to.y - k * from.y;
    this.layer.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
  }

  hide() {
    if (!this.captured) return;
    this.captured = null;
    delete this.host.dataset.on;
  }

  /** Frees the canvases' memory (iPad Safari limits it). */
  dispose() {
    this.hide();
    for (const canvas of [this.viewCanvas, this.surroundCanvas]) {
      canvas.width = 0;
      canvas.height = 0;
    }
    this.layer.remove();
  }
}

/** Sizes a canvas for a region (CSS px) drawn at `scale` device px per px. */
function size(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  scale: number,
  left: number,
  top: number,
) {
  const pw = Math.ceil(width * scale);
  const ph = Math.ceil(height * scale);
  // Resizing clears and reallocates: only when the size changes.
  if (canvas.width !== pw) canvas.width = pw;
  if (canvas.height !== ph) canvas.height = ph;
  Object.assign(canvas.style, {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
  });
}

/** Draws `region` (viewer px) of the captured view onto a canvas. */
function draw(
  canvas: HTMLCanvasElement,
  scale: number,
  region: Rect,
  src: SnapshotSource,
  background: string,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(scale, 0, 0, scale, -region.x * scale, -region.y * scale);
  ctx.fillStyle = background;
  ctx.fillRect(region.x, region.y, region.width, region.height);
  const t = src.transform;
  const pageEls = new Map(
    [...src.container.querySelectorAll<HTMLElement>(".doc-page")].map((el) => [
      el.dataset.key ?? "",
      el,
    ]),
  );
  for (const page of src.pages) {
    const rect: Rect = {
      x: t.x,
      y: t.y + page.top * t.scale,
      width: DOC_WIDTH * t.scale,
      height: page.height * t.scale,
    };
    if (!overlaps(rect, region)) continue;
    drawPage(ctx, page, rect, pageEls.get(page.key));
    drawMarks(
      ctx,
      page,
      rect,
      src.marks.filter((m) => m.pageKey === page.key),
    );
  }
  drawNotesBoxes(ctx, src.container, region);
  drawPins(ctx, src, region);
}

function drawPage(
  ctx: CanvasRenderingContext2D,
  page: PageLayout,
  rect: Rect,
  el: HTMLElement | undefined,
) {
  ctx.fillStyle = "#fff";
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  if (!el) return;
  // Screen px per page point.
  const f = rect.width / page.size.width;
  const [baseHost, tileHost] =
    el.querySelectorAll<HTMLElement>(".viewer-layer");
  const base = baseHost?.querySelector("canvas");
  if (base && base.width > 0)
    ctx.drawImage(base, rect.x, rect.y, rect.width, rect.height);
  // The sharp pieces, from their place on the page (page units).
  for (const tile of tileHost?.querySelectorAll("canvas") ?? []) {
    if (tile.width === 0) continue;
    ctx.drawImage(
      tile,
      rect.x + Number(tile.dataset.x) * f,
      rect.y + Number(tile.dataset.y) * f,
      Number(tile.dataset.w) * f,
      Number(tile.dataset.h) * f,
    );
  }
}

/** A page's marks, in page units scaled onto its rectangle. */
function drawMarks(
  ctx: CanvasRenderingContext2D,
  page: PageLayout,
  rect: Rect,
  marks: DocMark[],
) {
  if (marks.length === 0) return;
  const f = rect.width / page.size.width;
  ctx.save();
  ctx.translate(rect.x, rect.y);
  ctx.scale(f, f);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const mark of marks) {
    if (mark.tool === "text") {
      drawCallout(ctx, mark, page);
      continue;
    }
    const style = markStyle(mark, page.size);
    ctx.globalAlpha = style.opacity;
    ctx.globalCompositeOperation = isHighlight(mark)
      ? "multiply"
      : "source-over";
    ctx.strokeStyle = ctx.fillStyle = style.colour;
    ctx.lineWidth = style.width;
    const drawing = drawMark(mark, page.size);
    const path = new Path2D(drawing.d);
    if (isFilled(mark, drawing)) {
      ctx.globalAlpha = SHAPE_FILL_OPACITY;
      ctx.fill(path);
      ctx.globalAlpha = style.opacity;
    }
    ctx.stroke(path);
    if (drawing.head) ctx.fill(new Path2D(drawing.head));
  }
  ctx.restore();
}

/** A text callout, in page units (the context is already scaled). */
function drawCallout(
  ctx: CanvasRenderingContext2D,
  mark: DocMark,
  page: PageLayout,
) {
  const { box, metrics, lines, leader } = layoutCallout(
    mark,
    page.size,
    measureArial,
  );
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.strokeStyle = ctx.fillStyle = mark.colour;
  if (leader) {
    ctx.lineWidth = leader.width;
    ctx.beginPath();
    leader.points.forEach((p, i) =>
      i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y),
    );
    ctx.stroke();
    ctx.beginPath();
    leader.head.forEach((p, i) =>
      i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y),
    );
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = "#fff";
  ctx.fillRect(box.x, box.y, box.width, box.height);
  ctx.lineWidth = metrics.border;
  ctx.strokeRect(
    box.x + metrics.border / 2,
    box.y + metrics.border / 2,
    box.width - metrics.border,
    box.height - metrics.border,
  );
  ctx.fillStyle = mark.colour;
  ctx.font = `${metrics.fontSize}px Arial, Helvetica, sans-serif`;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  for (const line of lines) ctx.fillText(line.text, line.x, line.baseline);
}

/** The notes boxes as laid out on the page (read from the DOM). */
function drawNotesBoxes(
  ctx: CanvasRenderingContext2D,
  container: HTMLElement,
  region: Rect,
) {
  const origin = container.getBoundingClientRect();
  for (const box of container.querySelectorAll<HTMLElement>(
    ".observation-box",
  )) {
    const r = box.getBoundingClientRect();
    const rect: Rect = {
      x: r.left - origin.left,
      y: r.top - origin.top,
      width: r.width,
      height: r.height,
    };
    if (!overlaps(rect, region) || !rect.width) continue;
    // Screen px per page point, from the box's own size in page points.
    const k = rect.width / parseFloat(box.style.width);
    const fontSize = parseFloat(box.style.fontSize) * k;
    const lineHeight = parseFloat(box.style.lineHeight) * k;
    const padding = parseFloat(box.style.padding) * k;
    const border = parseFloat(box.style.borderWidth) * k;
    const family = getComputedStyle(box).fontFamily;

    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();
    ctx.fillStyle = "#fff";
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.strokeStyle = northrop.markup.blue;
    ctx.lineWidth = border;
    ctx.strokeRect(
      rect.x + border / 2,
      rect.y + border / 2,
      rect.width - border,
      rect.height - border,
    );
    const maxWidth = rect.width - 2 * (padding + border);
    let y = rect.y + border + padding;
    ctx.textBaseline = "middle";
    for (const line of box.children) {
      const header = line.classList.contains("observation-box-header");
      const heading = line.classList.contains("observation-box-heading");
      if (heading) y += 0.35 * fontSize;
      ctx.font = `${header || heading ? "700" : "400"} ${fontSize}px ${family}`;
      ctx.fillStyle = header
        ? northrop.markup.header
        : line.classList.contains("observation-box-instruction")
          ? northrop.colours.red
          : northrop.markup.blue;
      for (const text of wrap(ctx, line.textContent ?? "", maxWidth)) {
        ctx.fillText(text, rect.x + border + padding, y + lineHeight / 2);
        y += lineHeight;
      }
    }
    ctx.restore();
  }
}

/** Splits text into lines no wider than `maxWidth` (at word breaks). */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line || lines.length === 0) lines.push(line);
  return lines;
}

/** Arrows (in page units, like the overlay) and then pins on top. */
function drawPins(
  ctx: CanvasRenderingContext2D,
  src: SnapshotSource,
  region: Rect,
) {
  const t = src.transform;
  const pages = new Map(src.pages.map((p) => [p.key, p]));
  const colour = (pin: DocPin) =>
    pin.kind === "instruction" ? northrop.colours.red : northrop.markup.blue;
  const toScreen = (page: PageLayout, n: Point) =>
    pageToScreen(t, pagePointToDoc(page, n));

  for (const pin of src.pins) {
    const page = pages.get(pin.pageKey);
    if (!page || pin.arrows.length === 0) continue;
    const { width, height } = page.size;
    const f = (DOC_WIDTH * t.scale) / width;
    const m = arrowMetrics(page.size);
    ctx.strokeStyle = ctx.fillStyle = colour(pin);
    ctx.lineWidth = m.strokeWidth * f;
    ctx.lineCap = "round";
    for (const arrow of pin.arrows) {
      const shape = arrowShape(
        { x: pin.x * width, y: pin.y * height },
        { x: arrow.x * width, y: arrow.y * height },
        page.size,
      );
      if (!shape) continue;
      const pt = (p: Point) =>
        toScreen(page, { x: p.x / width, y: p.y / height });
      ctx.lineJoin = "round";
      ctx.beginPath();
      shape.line
        .map(pt)
        .forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      const head = shape.head.map(pt);
      ctx.beginPath();
      ctx.moveTo(head[0].x, head[0].y);
      ctx.lineTo(head[1].x, head[1].y);
      ctx.lineTo(head[2].x, head[2].y);
      ctx.closePath();
      ctx.fill();
    }
  }

  const font = getComputedStyle(src.container).fontFamily;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const pin of src.pins) {
    const page = pages.get(pin.pageKey);
    if (!page) continue;
    const p = toScreen(page, pin);
    const reach = PIN_RADIUS + 8;
    if (
      !overlaps(
        { x: p.x - reach, y: p.y - reach, width: 2 * reach, height: 2 * reach },
        region,
      )
    )
      continue;
    if (pin.selected) {
      ring(ctx, p, PIN_RADIUS + 4.5, 3, "#fff");
      ring(ctx, p, PIN_RADIUS + 7.5, 3, northrop.colours.maroon);
    }
    ctx.beginPath();
    ctx.arc(p.x, p.y, PIN_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(p.x, p.y, PIN_RADIUS - 2, 0, Math.PI * 2);
    ctx.fillStyle = colour(pin);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = `700 14px ${font}`;
    ctx.fillText(pin.letter, p.x, p.y + 0.5);
  }
}

function ring(
  ctx: CanvasRenderingContext2D,
  p: Point,
  radius: number,
  width: number,
  colour: string,
) {
  ctx.beginPath();
  ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.stroke();
}
