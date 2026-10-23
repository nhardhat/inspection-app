/**
 * Editable PDF for Bluebeam (spike, feedback round 1 item 7): the memo's
 * per-job text as form fields in Figtree, where the normal export draws it.
 * Branding, labels, the disclaimer and the office block stay drawn.
 */
import { rgb, type PDFDocument, type PDFFont, type PDFPage } from "pdf-lib";
import { northrop } from "../../../brand/northrop";
import type { MemoAssets, MemoFieldLine } from "../../memo/pdf/renderMemoPdf";

const PAGE_H = northrop.page.height;
/** Figtree's ascent and descent, in font sizes; and room round the text. */
const ASCENT = 0.95;
const DESCENT = 0.3;
const PAD = 1.5;
const GREY = rgb(0x3b / 255, 0x3b / 255, 0x3b / 255);

const BOLD_FIELDS = new Set(["Name"]);
const SEMIBOLD_FIELDS = new Set(["Job name", "Reference"]);

export async function addMemoFields(
  doc: PDFDocument,
  pages: PDFPage[],
  lines: MemoFieldLine[],
  fonts: MemoAssets["fonts"],
): Promise<number> {
  // Whole fonts (not subsets), so any letter typed in Bluebeam can show.
  const embed = (bytes: Uint8Array) => doc.embedFont(bytes, { subset: false });
  const font: Record<"regular" | "bold" | "semiBold", PDFFont> = {
    regular: await embed(fonts.regular),
    bold: await embed(fonts.bold),
    semiBold: await embed(fonts.semiBold),
  };
  const groups = new Map<string, MemoFieldLine[]>();
  for (const line of lines) {
    const key = `${line.name}\u0000${line.page}`;
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }
  const form = doc.getForm();
  for (const group of groups.values()) {
    const first = group[0];
    const last = group[group.length - 1];
    const name =
      first.page > 0 ? `${first.name} (page ${first.page + 1})` : first.name;
    const f = BOLD_FIELDS.has(first.name)
      ? font.bold
      : SEMIBOLD_FIELDS.has(first.name)
        ? font.semiBold
        : font.regular;
    const x = Math.min(...group.map((l) => l.x)) - PAD;
    const top = first.baseline - first.size * ASCENT - PAD;
    const multiline = first.multiline || group.length > 1;
    // A multiline field sets its first line a little lower: room below it.
    const bottom =
      last.baseline + last.size * (DESCENT + (multiline ? 0.4 : 0)) + PAD;
    const field = form.createTextField(name);
    if (multiline) field.enableMultiline();
    field.setText(group.map((l) => l.text).join(" "));
    field.addToPage(pages[first.page], {
      x,
      y: PAGE_H - bottom,
      width: first.right - x + PAD,
      height: bottom - top,
      font: f,
      textColor: GREY,
      borderWidth: 0,
    });
    field.setFontSize(first.size);
    field.updateAppearances(f);
  }
  return groups.size;
}
