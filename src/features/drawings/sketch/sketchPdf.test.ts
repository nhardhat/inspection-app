import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, test } from "vitest";
import { northrop } from "../../../brand/northrop";
import {
  buildSketchPdf,
  sketchNumber,
  sketchPageSize,
  type SketchAssets,
} from "./sketchPdf";

const read = (url: string) => new Uint8Array(readFileSync(fileURLToPath(url)));
const assets: SketchAssets = {
  regular: read(northrop.assets.fonts.regular),
  semiBold: read(northrop.assets.fonts.semiBold),
  wordmark: read(northrop.assets.wordmarkMaroon),
};
const fields = {
  project: "Example Apartments",
  jobNumber: "SY000001",
  designed: "T. Engineer",
  date: "20/10/2026",
};

async function text(bytes: Uint8Array) {
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const content = await (await doc.getPage(1)).getTextContent();
  await doc.loadingTask.destroy();
  return content.items.map((it) => ("str" in it ? it.str : "")).join(" ");
}

describe("sketch pages", () => {
  test("sheet sizes, portrait and landscape", () => {
    const [w, h] = sketchPageSize({ size: "A4", orientation: "portrait" });
    expect([Math.round(w), Math.round(h)]).toEqual([595, 842]);
    const [lw, lh] = sketchPageSize({ size: "A1", orientation: "landscape" });
    expect([Math.round(lw), Math.round(lh)]).toEqual([2384, 1684]);
    expect(sketchNumber(3)).toBe("SK03");
  });

  test("the calc pad strip, filled in, without PARTNERS", async () => {
    const bytes = await buildSketchPdf(
      { size: "A3", orientation: "landscape", scale: "1:50", number: 2 },
      fields,
      assets,
    );
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const t = await text(bytes);
    for (const s of [
      "PROJECTS:",
      "Example Apartments",
      "JOB NO:",
      "SY000001",
      "SKETCH NO:",
      "SK02",
      "REV NO:",
      "DESIGNED:",
      "T. Engineer",
      "SCALE :",
      "1:50",
      "DATE :",
      "20/10/2026",
    ])
      expect(t).toContain(s);
    expect(t).not.toContain("PARTNERS");
  });
});
