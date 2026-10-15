/**
 * The export pack (SPEC section 7): one PDF with the memo, the marked-up
 * drawing pages, then the photo appendix, page numbered through the pack
 * on the memo and appendix pages (drawings keep their own title blocks).
 */
import { PDFDocument, StandardFonts } from "pdf-lib";
import { boxHeader } from "../drawings/observationBox";
import { buildMemoPdfInput } from "../memo/buildMemo";
import { memoFilename } from "../memo/memoFilename";
import { referenceLine } from "../memo/memoTemplate";
import { writeMemo, type MemoAssets } from "../memo/pdf/renderMemoPdf";
import { appendDrawingPages } from "./drawingPages";
import {
  appendixPages,
  pinnedPages,
  type LoadBlob,
  type PackData,
} from "./packContents";
import { appendPhotoAppendix } from "./renderAppendix";

export interface PackProgress {
  /** 0..1 */
  fraction: number;
  /** e.g. "Drawing page 2 of 3". */
  label: string;
}

export interface Pack {
  bytes: Uint8Array;
  filename: string;
  pages: number;
}

/** Builds the pack. Drawings and photos are read one at a time. */
export async function buildPack(
  data: PackData,
  assets: MemoAssets,
  loadBlob: LoadBlob,
  onProgress: (progress: PackProgress) => void = () => {},
): Promise<Pack> {
  const { inspection, memo } = data;
  const pinned = pinnedPages(data.drawings, data.items, data.marks);
  const appendix = appendixPages(data);
  const photoCount = appendix
    .flatMap((p) => p.rows)
    .reduce((n, row) => n + row.photos.length, 0);
  // Rough weights: drawing pages are the slow part, then photos.
  const steps = 1 + pinned.length * 3 + photoCount + 2;
  let done = 0;
  const step = (n: number, label: string) => {
    done += n;
    onProgress({ fraction: Math.min(1, done / steps), label });
  };

  onProgress({ fraction: 0, label: "Memo" });
  const doc = await PDFDocument.create();
  const memoInput = buildMemoPdfInput(
    memo,
    inspection,
    data.items,
    data.conditionSnippets,
    data.photoLine,
    data.referLine,
  );
  const written = await writeMemo(doc, memoInput, assets, data.signature);
  step(1, pinned.length > 0 ? `Drawing page 1 of ${pinned.length}` : "Photos");

  const markupFonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  const drawingCount = await appendDrawingPages(
    doc,
    {
      pages: pinned,
      generalNotes: data.items.filter((item) => item.general),
      boxes: data.boxes,
      header: boxHeader(inspection),
      observationHeading: data.observationHeading,
      loadPdf: async (drawing) => (await loadBlob(drawing.pdfBlobId)).data,
      onPage: (n, total) =>
        step(3, n < total ? `Drawing page ${n + 1} of ${total}` : "Photos"),
    },
    markupFonts,
  );

  let photosDone = 0;
  await appendPhotoAppendix(doc, {
    pages: appendix,
    title: referenceLine(memo.reference, inspection.itemInspected),
    firstPageNumber: written.pages.length + drawingCount + 1,
    fonts: written.fonts,
    icon: written.icon,
    loadPhoto: async (photo) => {
      const blob = await loadBlob(photo.blobId);
      photosDone += 1;
      step(1, `Photo ${photosDone} of ${photoCount}`);
      return blob;
    },
  });

  step(1, "Saving");
  const bytes = await doc.save();
  step(1, "Done");
  return {
    bytes,
    filename: memoFilename(
      inspection.jobNumber,
      memo.reference,
      inspection.itemInspected,
    ),
    pages: doc.getPageCount(),
  };
}
