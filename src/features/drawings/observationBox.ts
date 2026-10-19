/**
 * The notes box ("observations box" in SPEC section 5) drawn on each
 * drawing page that has pins. Pure layout and text rules shared by the viewer and, in build
 * step 8, the PDF export, so both draw it the same size in the same place.
 * Sizes are in page units (PDF points) and scale with the sheet.
 */
import { northrop } from "../../brand/northrop";
import type { BoxTextSize, Item, Snippet } from "../../db/types";
import { formatDdMmYyyy } from "../../lib/dates";
import { indexForLetter } from "../items/letters";
import type { Point, Size } from "./viewer/viewTransform";

export interface BoxMetrics {
  fontSize: number;
  lineHeight: number;
  padding: number;
  width: number;
  margin: number;
  borderWidth: number;
}

/** PDF points per millimetre on the printed sheet. */
const POINTS_PER_MM = 72 / 25.4;

/**
 * Default inset from the sheet's top and right edges: 15 mm on every sheet
 * size, just inside a standard 10 mm drawing frame, so the box roughly lines
 * up with the title block's right edge without sitting on the border line.
 */
export const BOX_INSET_MM = 15;

/** A box's own size, if changed (engineer, 2026-10-20). */
export interface BoxStyle {
  /** Fraction of the page width. */
  width?: number;
  textSize?: BoxTextSize;
}

/** Text size multipliers: M is the original size. */
export const BOX_TEXT_SCALE: Record<BoxTextSize, number> = {
  S: 0.8,
  M: 1,
  L: 1.3,
};

/** The narrowest a box can be, in text heights. */
const MIN_WIDTH_EMS = 12;

/**
 * Text is 1.2% of the sheet's short side at M: about 20 pt on A1, 10 pt on
 * A3 and 7 pt on A4 (S and L scale it). The box is 50 text-heights wide
 * unless resized, so a typical header (in capitals) fits on one line.
 */
export function boxMetrics(page: Size, style: BoxStyle = {}): BoxMetrics {
  const short = Math.min(page.width, page.height);
  const fontSize = short * 0.012 * BOX_TEXT_SCALE[style.textSize ?? "M"];
  const max = page.width * 0.9;
  const min = Math.min(fontSize * MIN_WIDTH_EMS, max);
  const width = style.width
    ? Math.min(Math.max(style.width * page.width, min), max)
    : Math.min(fontSize * 50, max);
  return {
    fontSize,
    lineHeight: fontSize * 1.3,
    padding: fontSize * 0.6,
    width,
    margin: BOX_INSET_MM * POINTS_PER_MM,
    borderWidth: Math.max(0.5, fontSize * 0.06),
  };
}

/** Width as a fraction of the page width (positions are stored 0..1). */
export function boxWidthFraction(page: Size, style: BoxStyle = {}): number {
  return boxMetrics(page, style).width / page.width;
}

/** The narrowest and widest a box can be, as fractions of the page width. */
export function boxWidthLimits(page: Size, style: BoxStyle = {}) {
  const { fontSize } = boxMetrics(page, style);
  const max = 0.9;
  return {
    min: Math.min((fontSize * MIN_WIDTH_EMS) / page.width, max),
    max,
  };
}

/** Default spot: top right, inset by the margin (BOX_INSET_MM). */
export function defaultBoxPosition(page: Size): Point {
  const m = boxMetrics(page);
  return {
    x: Math.max(0, 1 - (m.margin + m.width) / page.width),
    y: m.margin / page.height,
  };
}

/** Keeps the box's top-left on the page with the whole box width inside. */
export function clampBoxPosition(
  p: Point,
  page: Size,
  style: BoxStyle = {},
): Point {
  return {
    x: Math.min(
      Math.max(0, p.x),
      Math.max(0, 1 - boxWidthFraction(page, style)),
    ),
    y: Math.min(Math.max(0, p.y), 0.98),
  };
}

/** "Test Engineer" -> "T. Engineer"; a single name is returned as is. */
export function initialAndSurname(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return words[0] ?? "";
  return `${words[0][0].toUpperCase()}. ${words[words.length - 1]}`;
}

/**
 * "NORTHROP INSPECTION | Level 3 slab reinforcement | T. Engineer | 01/10/2026".
 * Empty parts are left out.
 */
export function boxHeader(inspection: {
  itemInspected: string;
  inspector: string;
  date: string;
}): string {
  return [
    `${northrop.name.toUpperCase()} INSPECTION`,
    inspection.itemInspected.trim(),
    initialAndSurname(inspection.inspector),
    inspection.date ? formatDdMmYyyy(inspection.date) : "",
  ]
    .filter(Boolean)
    .join(" | ");
}

/** The observations heading when no heading snippet exists. */
export const DEFAULT_OBSERVATION_HEADING = "Noted for information:";

/** The heading snippet the box uses: the starter one, else the first. */
export function observationHeading(
  headings: Pick<Snippet, "id" | "text">[],
): string {
  return (
    headings.find((s) => s.id === "heading-noted-for-information")?.text ??
    headings[0]?.text ??
    DEFAULT_OBSERVATION_HEADING
  );
}

/** Fixed template heading for the page's instructions in the box. */
export const INSTRUCTIONS_HEADING = "Instructions:";

/**
 * That page's items of one kind in letter order, e.g. "D. Existing crack";
 * an instruction needing photo confirmation ends with * (as in the memo).
 */
export function itemLines(items: Item[], kind: Item["kind"]): string[] {
  return items
    .filter((item) => item.kind === kind)
    .sort((a, b) => indexForLetter(a.letter) - indexForLetter(b.letter))
    .map((item) => {
      const mark =
        item.kind === "instruction" && item.requiresPhotoConfirmation
          ? " *"
          : "";
      return `${item.letter}. ${item.text.trim()}${mark}`.trim();
    });
}

/** That page's observations in letter order. */
export function observationLines(items: Item[]): string[] {
  return itemLines(items, "observation");
}

export interface BoxLine {
  text: string;
  style: "header" | "heading" | "item";
  /**
   * Colour group: the header is black (markup.header); instruction lines
   * match the red instruction pins; observation lines use markup blue.
   */
  tone: "header" | "instruction" | "observation";
}

/**
 * Everything the box shows, top to bottom, in capitals: the header (black),
 * then observations (if any, in blue), then instructions (if any, in red).
 * The viewer and the PDF export both draw these lines, so they always match.
 */
export function boxLines(options: {
  header: string;
  observationHeading: string;
  items: Item[];
}): BoxLine[] {
  const lines: BoxLine[] = [
    { text: options.header, style: "header", tone: "header" },
  ];
  const section = (heading: string, items: string[], tone: BoxLine["tone"]) => {
    if (items.length === 0) return;
    lines.push({ text: heading, style: "heading", tone });
    for (const text of items) lines.push({ text, style: "item", tone });
  };
  section(
    options.observationHeading,
    itemLines(options.items, "observation"),
    "observation",
  );
  section(
    INSTRUCTIONS_HEADING,
    itemLines(options.items, "instruction"),
    "instruction",
  );
  return lines.map((line) => ({ ...line, text: line.text.toUpperCase() }));
}
