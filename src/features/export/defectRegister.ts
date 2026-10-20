/**
 * The defect register (engineer, 2026-10-20; feedback round 1, item 5): an
 * Excel workbook with one row per item for the builder to close out,
 * made on the device (ExcelJS, bundled and loaded only when exporting).
 * Instructions first, then observations (general notes among them, as in
 * the notes box), each in letter order. Photo refs match the PDF's photo
 * appendix (IA1, OB2…).
 */
import { northrop } from "../../brand/northrop";
import type { Item } from "../../db/types";
import { formatDdMmYyyy } from "../../lib/dates";
import {
  documentPageNumbers,
  pageKey,
} from "../drawings/document/documentLayout";
import { indexForLetter } from "../items/letters";
import { itemSpots } from "../items/spots";
import { memoFilename } from "../memo/memoFilename";
import type { PackData } from "./packContents";

export interface RegisterRow {
  /** "IA", "OB". */
  ref: string;
  type: "Instruction" | "Observation" | "General note";
  description: string;
  /** The sheet(s) it's pinned on; "All" for a general note. */
  drawing: string;
  /** Page number(s) through the document; "All" for a general note. */
  sheet: string;
  /** Instructions: "Yes" or "No"; observations: "". */
  photoConfirmation: string;
  /** "IA1, IA2" as labelled in the photo appendix. */
  photoRefs: string;
  dateRaised: string;
  inspector: string;
}

export interface RegisterHeader {
  jobNumber: string;
  jobName: string;
  reference: string;
  itemInspected: string;
  date: string;
}

/** The register's header block. */
export function registerHeader(data: PackData): RegisterHeader {
  const { inspection, memo } = data;
  return {
    jobNumber: inspection.jobNumber.trim(),
    jobName: inspection.jobName.trim(),
    reference: memo.reference.trim(),
    itemInspected: inspection.itemInspected.trim(),
    date: inspection.date ? formatDdMmYyyy(inspection.date) : "",
  };
}

/** One row per item: instructions, then observations, in letter order. */
export function registerRows(data: PackData): RegisterRow[] {
  const { inspection, drawings, photos } = data;
  const numbers = documentPageNumbers(drawings);
  const name = (drawingId: string, page: number) => {
    const drawing = drawings.find((d) => d.id === drawingId);
    const from = drawing?.pages[page - 1]?.from;
    return (
      (from && drawings.find((d) => d.id === from)?.name) ?? drawing?.name ?? ""
    );
  };
  const kind = (item: Item) => (item.kind === "instruction" ? 0 : 1);
  const date = inspection.date ? formatDdMmYyyy(inspection.date) : "";
  return [...data.items]
    .sort(
      (a, b) =>
        kind(a) - kind(b) ||
        indexForLetter(a.letter) - indexForLetter(b.letter),
    )
    .map((item) => {
      const prefix = `${item.kind === "instruction" ? "I" : "O"}${item.letter}`;
      const spots = item.general ? [] : itemSpots(item);
      const unique = (values: string[]) => [...new Set(values)].join(", ");
      return {
        ref: prefix,
        type: item.general
          ? "General note"
          : item.kind === "instruction"
            ? "Instruction"
            : "Observation",
        description: item.text.trim(),
        drawing: item.general
          ? "All"
          : unique(spots.map((s) => name(s.drawingId, s.page))),
        sheet: item.general
          ? "All"
          : unique(
              spots.flatMap((s) => {
                const n = numbers.get(pageKey(s.drawingId, s.page));
                return n ? [String(n)] : [];
              }),
            ),
        photoConfirmation:
          item.kind === "instruction"
            ? item.requiresPhotoConfirmation
              ? "Yes"
              : "No"
            : "",
        photoRefs: item.photoIds
          .filter((id) => photos.has(id))
          .map((_, i) => `${prefix}${i + 1}`)
          .join(", "),
        dateRaised: date,
        inspector: inspection.inspector.trim(),
      };
    });
}

/** "SY000001-SIM001-A-Level 3 slab - Defect register.xlsx". */
export function registerFilename(data: PackData): string {
  const { inspection, memo } = data;
  return memoFilename(
    inspection.jobNumber,
    memo.reference,
    inspection.itemInspected,
  ).replace(/\.pdf$/, " - Defect register.xlsx");
}

/** The columns, with the builder's three left empty to fill in. */
const COLUMNS: {
  header: string;
  key: keyof RegisterRow | null;
  width: number;
}[] = [
  { header: "Ref", key: "ref", width: 7 },
  { header: "Type", key: "type", width: 13 },
  { header: "Description", key: "description", width: 50 },
  { header: "Drawing", key: "drawing", width: 22 },
  { header: "Sheet/page", key: "sheet", width: 11 },
  {
    header: "Photo confirmation required",
    key: "photoConfirmation",
    width: 14,
  },
  { header: "Photo refs", key: "photoRefs", width: 16 },
  { header: "Date raised", key: "dateRaised", width: 12 },
  { header: "Inspector", key: "inspector", width: 16 },
  { header: "Status", key: null, width: 14 },
  { header: "Date closed", key: null, width: 12 },
  { header: "Comments", key: null, width: 40 },
];

const argb = (hex: string) => `FF${hex.slice(1).toUpperCase()}`;

/** Builds the workbook (.xlsx bytes). */
export async function buildRegisterXlsx(data: PackData): Promise<Uint8Array> {
  const { Workbook } = (await import("exceljs")).default;
  const book = new Workbook();
  book.creator = northrop.name;
  const sheet = book.addWorksheet("Defect register", {
    pageSetup: {
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
  });
  sheet.columns = COLUMNS.map((c) => ({ width: c.width }));
  const maroon = argb(northrop.colours.maroon);
  const cream = argb(northrop.colours.cream);

  const header = registerHeader(data);
  const block: [string, string][] = [
    ["Job number", header.jobNumber],
    ["Job name", header.jobName],
    ["Memo reference", header.reference],
    ["Item inspected", header.itemInspected],
    ["Date", header.date],
  ];
  for (const [label, value] of block) {
    const row = sheet.addRow([label, "", value]);
    sheet.mergeCells(row.number, 1, row.number, 2);
    row.getCell(1).font = { bold: true, color: { argb: maroon } };
  }
  sheet.addRow([]);

  const head = sheet.addRow(COLUMNS.map((c) => c.header));
  head.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: maroon } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: cream } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  for (const r of registerRows(data)) {
    const row = sheet.addRow(COLUMNS.map((c) => (c.key ? r[c.key] : "")));
    row.alignment = { vertical: "top", wrapText: true };
  }
  // The header row stays in view; the table filters.
  sheet.views = [{ state: "frozen", ySplit: head.number }];
  sheet.autoFilter = {
    from: { row: head.number, column: 1 },
    to: { row: head.number, column: COLUMNS.length },
  };
  return new Uint8Array(await book.xlsx.writeBuffer());
}
