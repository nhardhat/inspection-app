import {
  deleteItemRecords,
  promoteCopy,
  reletterInspection,
  touchInspection,
} from "./items";
import { removePages } from "./pages";
import type { InspectionDb } from "./schema";
import type { Drawing, Item } from "./types";

export interface NewDrawing {
  name: string;
  /** PDF bytes (IndexedDB stores its own copy). */
  pdf: Uint8Array;
  pageCount: number;
  /** Each page's [width, height] in points. */
  pageSizes: [number, number][];
}

/** "S-101 Level 3.pdf" -> "S-101 Level 3". */
export function drawingNameFromFile(fileName: string): string {
  return fileName.replace(/\.pdf$/i, "").trim() || "Drawing";
}

/** Stores the PDF and its drawing record together. */
export async function addDrawing(
  db: InspectionDb,
  inspectionId: string,
  drawing: NewDrawing,
  now = Date.now(),
): Promise<Drawing> {
  return db.transaction(
    "rw",
    [db.inspections, db.drawings, db.blobs],
    async () => {
      const pdfBlobId = crypto.randomUUID();
      await db.blobs.add({
        id: pdfBlobId,
        // Its whole buffer as it is (no extra copy of a big set); a view
        // into a larger buffer is cut out.
        data:
          drawing.pdf.byteOffset === 0 &&
          drawing.pdf.byteLength === drawing.pdf.buffer.byteLength
            ? (drawing.pdf.buffer as ArrayBuffer)
            : drawing.pdf.slice().buffer,
        type: "application/pdf",
        size: drawing.pdf.byteLength,
      });
      const record: Drawing = {
        id: crypto.randomUUID(),
        inspectionId,
        name: drawing.name,
        pdfBlobId,
        pageCount: drawing.pageCount,
        pages: Array.from({ length: drawing.pageCount }, (_, i) => ({
          source: i + 1,
        })),
        fileSize: drawing.pdf.byteLength,
        pageSizes: drawing.pageSizes,
        // Strictly after the others, so document order never ties (several
        // files added at once).
        createdAt: Math.max(
          now,
          ...(
            await db.drawings
              .where("inspectionId")
              .equals(inspectionId)
              .toArray()
          ).map((d) => d.createdAt + 1),
        ),
      };
      await db.drawings.add(record);
      await touchInspection(db, inspectionId, now);
      return record;
    },
  );
}

/** Saves page sizes measured for a drawing added before they were stored. */
export async function setPageSizes(
  db: InspectionDb,
  id: string,
  pageSizes: [number, number][],
): Promise<void> {
  await db.drawings.update(id, { pageSizes });
}

/** An inspection's drawings in document order (the order they were added). */
export async function listDrawings(db: InspectionDb, inspectionId: string) {
  const drawings = await db.drawings
    .where("inspectionId")
    .equals(inspectionId)
    .toArray();
  return drawings.sort((a, b) => a.createdAt - b.createdAt);
}

export async function renameDrawing(
  db: InspectionDb,
  id: string,
  name: string,
  now = Date.now(),
): Promise<void> {
  await db.transaction("rw", [db.inspections, db.drawings], async () => {
    const drawing = await db.drawings.get(id);
    if (!drawing) throw new Error(`Drawing ${id} not found`);
    await db.drawings.update(id, { name: name.trim() || drawing.name });
    await touchInspection(db, drawing.inspectionId, now);
  });
}

/**
 * Deletes a drawing, its PDF, its items (with photos) and its observation
 * boxes, then re-letters the inspection's remaining items.
 */
export async function deleteDrawing(
  db: InspectionDb,
  id: string,
  now = Date.now(),
): Promise<void> {
  await db.transaction(
    "rw",
    [
      db.inspections,
      db.drawings,
      db.blobs,
      db.items,
      db.photos,
      db.observationBoxes,
      db.markups,
    ],
    async () => {
      const drawing = await db.drawings.get(id);
      if (!drawing) return;
      const drawings = await listDrawings(db, drawing.inspectionId);
      const order = drawings.map((d) => d.id);
      // Its pages moved into other drawings show its PDF: they go too.
      for (const other of drawings) {
        if (other.id === id) continue;
        const borrowed = (other.pages ?? []).flatMap((p, i) =>
          p.from === id ? [i + 1] : [],
        );
        await removePages(db, other, borrowed, order);
      }
      const all = await db.items
        .where("inspectionId")
        .equals(drawing.inspectionId)
        .toArray();
      const doomed: Item[] = [];
      for (const item of all) {
        if (item.drawingId === id) {
          // Pinned elsewhere too: a copy on another drawing takes over.
          const promoted = promoteCopy(item, order, id);
          if (promoted) await db.items.put(promoted);
          else doomed.push(item);
        } else if ((item.copies ?? []).some((c) => c.drawingId === id)) {
          await db.items.update(item.id, {
            copies: item.copies!.filter((c) => c.drawingId !== id),
          });
        }
      }
      await deleteItemRecords(db, doomed);
      await db.observationBoxes.filter((box) => box.drawingId === id).delete();
      await db.markups.where("drawingId").equals(id).delete();
      await db.blobs.delete(drawing.pdfBlobId);
      await db.drawings.delete(id);
      await reletterInspection(db, drawing.inspectionId);
      await touchInspection(db, drawing.inspectionId, now);
    },
  );
}

/**
 * Puts an inspection's drawings in a new order (ids, first to last). The
 * document, page numbers, PDF pack and letters all follow drawing order,
 * which is createdAt: the drawings swap their createdAt values, so new
 * drawings still go last. Re-letters the items.
 */
export async function reorderDrawings(
  db: InspectionDb,
  inspectionId: string,
  order: string[],
  now = Date.now(),
): Promise<void> {
  await db.transaction(
    "rw",
    [db.inspections, db.drawings, db.items],
    async () => {
      const drawings = await listDrawings(db, inspectionId);
      const ids = new Set(drawings.map((d) => d.id));
      if (order.length !== ids.size || !order.every((id) => ids.has(id)))
        throw new Error("The new order must list every drawing once");
      const times = drawings.map((d) => d.createdAt);
      let changed = false;
      for (const [i, id] of order.entries()) {
        if (drawings[i].id === id) continue;
        changed = true;
        await db.drawings.update(id, { createdAt: times[i] });
      }
      if (!changed) return;
      await reletterInspection(db, inspectionId);
      await touchInspection(db, inspectionId, now);
    },
  );
}

/** Moves a drawing one place earlier (-1) or later (1) in the document. */
export async function moveDrawing(
  db: InspectionDb,
  drawingId: string,
  direction: -1 | 1,
  now = Date.now(),
): Promise<void> {
  const drawing = await db.drawings.get(drawingId);
  if (!drawing) return;
  const order = (await listDrawings(db, drawing.inspectionId)).map((d) => d.id);
  const from = order.indexOf(drawingId);
  const to = from + direction;
  if (to < 0 || to >= order.length) return;
  [order[from], order[to]] = [order[to], order[from]];
  await reorderDrawings(db, drawing.inspectionId, order, now);
}
