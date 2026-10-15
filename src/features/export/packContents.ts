/**
 * What goes in the export pack, worked out without pdf-lib so the Site
 * memo screen can show it (and warnings) without loading the PDF code.
 */
import type {
  Drawing,
  Item,
  JobInspection,
  Markup,
  Memo,
  ObservationBox,
  Photo,
  Snippet,
} from "../../db/types";
import { compareItems, itemLabel } from "../items/letters";
import { isOnPage, itemSpots } from "../items/spots";
import {
  appendixGroups,
  layoutAppendix,
  type AppendixPage,
} from "./appendixLayout";

/** Everything the pack is built from, loaded by packData.ts. */
export interface PackData {
  inspection: JobInspection;
  memo: Memo;
  items: Item[];
  /** In document order. */
  drawings: Drawing[];
  boxes: ObservationBox[];
  /** Pen and highlighter marks (slice 2). */
  marks: Markup[];
  conditionSnippets: Snippet[];
  /** The note after instructions needing photo confirmation. */
  photoLine: string;
  observationHeading: string;
  photos: Map<string, Photo>;
  /** The memo's signature (PNG), if it prints one. */
  signature: Uint8Array | null;
}

/** Stored file bytes and type, by blob id. */
export type LoadBlob = (
  id: string,
) => Promise<{ data: Uint8Array; type: string }>;

export interface PackSummary {
  drawingPages: number;
  photos: number;
  appendixPages: number;
}

export interface PinnedPage {
  drawing: Drawing;
  /** 1-based position in Drawing.pages (what items refer to). */
  position: number;
  /** 1-based page of the drawing's PDF it shows. */
  source: number;
  /** Items pinned here (copies too): observations, then instructions, each in letter order. */
  items: Item[];
  /** Every pin on the page, copies included, with its item's letter. */
  pins: PagePin[];
  /** Pen and highlighter marks on the page, oldest first. */
  marks: Markup[];
}

/** A pin to burn in: its item's kind and letter at one spot. */
export interface PagePin {
  kind: Item["kind"];
  letter: string;
  x: number;
  y: number;
  arrows: Item["arrows"];
}

/** The pages that go in the pack (with pins or markup), in document order. */
export function pinnedPages(
  drawings: Drawing[],
  items: Item[],
  marks: Markup[] = [],
): PinnedPage[] {
  return drawings.flatMap((drawing) =>
    drawing.pages.flatMap((entry, i) => {
      const position = i + 1;
      if (entry.hidden) return [];
      const onPage = items
        .filter((it) => isOnPage(it, drawing.id, position))
        .sort(compareItems);
      const pins = onPage.flatMap((item) =>
        itemSpots(item)
          .filter((s) => s.drawingId === drawing.id && s.page === position)
          .map((s) => ({
            kind: item.kind,
            letter: item.letter,
            x: s.x,
            y: s.y,
            arrows: s.arrows,
          })),
      );
      const pageMarks = marks
        .filter((m) => m.drawingId === drawing.id && m.page === position)
        .sort((a, b) => a.createdAt - b.createdAt);
      return onPage.length > 0 || pageMarks.length > 0
        ? [
            {
              drawing,
              position,
              source: entry.source,
              items: onPage,
              pins,
              marks: pageMarks,
            },
          ]
        : [];
    }),
  );
}

export function appendixPages(data: PackData): AppendixPage[] {
  return layoutAppendix(
    appendixGroups(data.items, data.inspection.photoIds, data.photos),
  );
}

/** What the pack will hold, for the Export card before exporting. */
export function packSummary(data: PackData): PackSummary {
  const pages = appendixPages(data);
  return {
    drawingPages: pinnedPages(data.drawings, data.items, data.marks).length,
    photos: pages
      .flatMap((p) => p.rows)
      .reduce((n, row) => n + row.photos.length, 0),
    appendixPages: pages.length,
  };
}

/** Things worth checking before sending; none of them stop the export. */
export function packWarnings(data: PackData): string[] {
  const warnings: string[] = [];
  const empty = data.items
    .filter((item) => !item.text.trim())
    .map((item) => itemLabel(item));
  if (empty.length === 1) warnings.push(`${empty[0]} has no text.`);
  else if (empty.length > 1) warnings.push(`${empty.join(", ")} have no text.`);
  if (!data.memo.recipients.some((r) => r.to && (r.company || r.attn).trim()))
    warnings.push('The memo has no "To" recipient.');
  return warnings;
}
