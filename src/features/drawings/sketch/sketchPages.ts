/**
 * Sketch pages in an inspection (engineer, 2026-10-20). Each is a one-page
 * PDF made by the app (sketchPdf.ts), kept as its own drawing record
 * (`Drawing.sketch`), with its page moved into the drawing it was added
 * from, right after that page (DrawingPage.from, as for any page moved
 * between drawings). It's ticked Include in export, so even a blank one
 * goes in the pack.
 */
import { northrop } from "../../../brand/northrop";
import { addDrawing, deleteDrawing } from "../../../db/drawings";
import { movePageTo, setPagesIncluded } from "../../../db/pages";
import { loadJobInspection } from "../../../db/projects";
import type { InspectionDb } from "../../../db/schema";
import type { Drawing } from "../../../db/types";
import { formatDdMmYyyy } from "../../../lib/dates";
import { initialAndSurname } from "../observationBox";
import {
  buildSketchPdf,
  sketchNumber,
  sketchPageSize,
  type SketchAssets,
  type SketchSpec,
} from "./sketchPdf";

/** A sketch page's sheet without its number (given when it's made). */
export type SketchSheet = Omit<SketchSpec, "number">;

/** A3 landscape at NTS to start with. */
export const DEFAULT_SKETCH_SHEET: SketchSheet = {
  size: "A3",
  orientation: "landscape",
  scale: "NTS",
};

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Could not load ${url} (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Fonts and the wordmark, from the precache when offline. */
export async function loadSketchAssets(): Promise<SketchAssets> {
  const { fonts, wordmarkMaroon } = northrop.assets;
  const [regular, semiBold, wordmark] = await Promise.all([
    fetchBytes(fonts.regular),
    fetchBytes(fonts.semiBold),
    fetchBytes(wordmarkMaroon),
  ]);
  return { regular, semiBold, wordmark };
}

/** The sheet as a PDF, filled in from the inspection as it is now. */
async function sketchBytes(
  db: InspectionDb,
  inspectionId: string,
  spec: SketchSpec,
  assets: () => Promise<SketchAssets>,
): Promise<Uint8Array> {
  const job = await loadJobInspection(db, inspectionId);
  return buildSketchPdf(
    spec,
    {
      project: job?.jobName.trim() ?? "",
      jobNumber: job?.jobNumber.trim() ?? "",
      designed: initialAndSurname(job?.inspector ?? ""),
      date: job?.date ? formatDdMmYyyy(job.date) : "",
    },
    await assets(),
  );
}

/** Stores a sheet as a sketch drawing (its page not yet placed). */
async function storeSheet(
  db: InspectionDb,
  inspectionId: string,
  spec: SketchSpec,
  assets: () => Promise<SketchAssets>,
): Promise<Drawing> {
  const pdf = await sketchBytes(db, inspectionId, spec, assets);
  const drawing = await addDrawing(db, inspectionId, {
    name: `Sketch ${sketchNumber(spec.number)}`,
    pdf,
    pageCount: 1,
    pageSizes: [sketchPageSize(spec)],
  });
  await db.drawings.update(drawing.id, { sketch: spec });
  return { ...drawing, sketch: spec };
}

/**
 * Adds a sketch page right after a page (`drawingId`, `position`), numbered
 * after the inspection's other sketches (SK01, SK02…). Returns where it is.
 */
export async function addSketchPage(
  db: InspectionDb,
  inspectionId: string,
  after: { drawingId: string; position: number },
  sheet: SketchSheet,
  assets = loadSketchAssets,
): Promise<{ drawingId: string; page: number }> {
  const drawings = await db.drawings
    .where("inspectionId")
    .equals(inspectionId)
    .toArray();
  const number = Math.max(0, ...drawings.map((d) => d.sketch?.number ?? 0)) + 1;
  const sketch = await storeSheet(
    db,
    inspectionId,
    { ...sheet, number },
    assets,
  );
  const to = await movePageTo(
    db,
    sketch.id,
    1,
    after.drawingId,
    after.position + 1,
  );
  await setPagesIncluded(db, to.drawingId, [to.page], true);
  return to;
}

/**
 * Changes a sketch page's sheet (size, orientation or scale): a new sheet
 * with the same number takes its place; its pins and markup stay where they
 * are on the page (positions are relative to the sheet).
 */
export async function changeSketchPage(
  db: InspectionDb,
  sketchDrawingId: string,
  sheet: SketchSheet,
  assets = loadSketchAssets,
): Promise<void> {
  const old = await db.drawings.get(sketchDrawingId);
  if (!old?.sketch) return;
  const fresh = await storeSheet(
    db,
    old.inspectionId,
    { ...sheet, number: old.sketch.number },
    assets,
  );
  await db.transaction("rw", [db.drawings, db.blobs], async () => {
    // Its page shows the new sheet; the new sheet has no page of its own.
    await db.drawings.update(fresh.id, { pages: [] });
    const all = await db.drawings
      .where("inspectionId")
      .equals(old.inspectionId)
      .toArray();
    for (const d of all) {
      if (!d.pages.some((p) => p.from === old.id)) continue;
      await db.drawings.update(d.id, {
        pages: d.pages.map((p) =>
          p.from === old.id ? { ...p, from: fresh.id } : p,
        ),
      });
    }
    await db.blobs.delete(old.pdfBlobId);
    await db.drawings.delete(old.id);
  });
}

/** Deletes a sketch page, with any pins and markup on it. */
export async function deleteSketchPage(
  db: InspectionDb,
  sketchDrawingId: string,
): Promise<void> {
  // Its page sits in another drawing, showing this sheet: it goes with it.
  await deleteDrawing(db, sketchDrawingId);
}
