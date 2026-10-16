/**
 * Page management (the Pages view, SPEC section 5): hide, restore and
 * duplicate a drawing's pages. The PDF itself never changes; a drawing's
 * `pages` list says which PDF page each position shows and whether it is
 * hidden. Items and notes boxes refer to positions, so hiding moves
 * nothing, and duplicating moves the pins, boxes and markup of later pages
 * along.
 */
import { itemSpots } from "../features/items/spots";
import {
  deleteItemRecords,
  promoteCopy,
  reletterInspection,
  touchInspection,
} from "./items";
import type { InspectionDb } from "./schema";
import type { Drawing, DrawingPage, Item, Markup } from "./types";

/** The drawing whose PDF a page shows (its own, unless moved here). */
export function pdfDrawingOf(drawingId: string, page: DrawingPage): string {
  return page.from ?? drawingId;
}

function pagesOf(drawing: Drawing): DrawingPage[] {
  return (
    drawing.pages ??
    Array.from({ length: drawing.pageCount }, (_, i) => ({ source: i + 1 }))
  );
}

/**
 * Positions (1-based) on a drawing that have pins (copies included) or
 * markup: they can't be hidden.
 */
export function markedPositions(
  drawingId: string,
  items: Item[],
  marks: Pick<Markup, "drawingId" | "page">[] = [],
): Set<number> {
  return new Set([
    ...items
      .flatMap(itemSpots)
      .filter((spot) => spot.drawingId === drawingId)
      .map((spot) => spot.page),
    ...marks.filter((m) => m.drawingId === drawingId).map((m) => m.page),
  ]);
}

/**
 * Renumbers a drawing's pages in its items' copies (the originals are
 * updated through the drawingId index by the callers).
 */
async function remapCopies(
  db: InspectionDb,
  inspectionId: string,
  drawingId: string,
  newPosition: (page: number) => number,
): Promise<void> {
  await db.items
    .where("inspectionId")
    .equals(inspectionId)
    .filter((item) =>
      (item.copies ?? []).some((c) => c.drawingId === drawingId),
    )
    .modify((item) => {
      item.copies = item.copies!.map((c) =>
        c.drawingId === drawingId ? { ...c, page: newPosition(c.page) } : c,
      );
    });
}

/**
 * Hides (or restores) pages of one drawing. Pages with pins or markup are
 * never hidden (they must be removed first); returns how many changed.
 */
export async function setPagesHidden(
  db: InspectionDb,
  drawingId: string,
  positions: number[],
  hidden: boolean,
  now = Date.now(),
): Promise<number> {
  return db.transaction(
    "rw",
    [db.inspections, db.drawings, db.items, db.markups],
    async () => {
      const drawing = await db.drawings.get(drawingId);
      if (!drawing) return 0;
      // Every item of the inspection: a copy may be on this drawing.
      const items = await db.items
        .where("inspectionId")
        .equals(drawing.inspectionId)
        .toArray();
      const marks = await db.markups
        .where("drawingId")
        .equals(drawingId)
        .toArray();
      const marked = markedPositions(drawingId, items, marks);
      const pages = pagesOf(drawing).map((page) => ({ ...page }));
      let changed = 0;
      for (const position of positions) {
        const page = pages[position - 1];
        if (!page || Boolean(page.hidden) === hidden) continue;
        if (hidden && marked.has(position)) continue;
        if (hidden) page.hidden = true;
        else delete page.hidden;
        changed++;
      }
      if (changed) {
        await db.drawings.update(drawingId, { pages });
        await touchInspection(db, drawing.inspectionId, now);
      }
      return changed;
    },
  );
}

/**
 * Duplicates a page: a copy (of the same PDF page, without its pins or
 * markup) goes right after it, and later pages' pins, notes boxes and
 * markup move along one.
 * Returns the copy's position.
 */
export async function duplicatePage(
  db: InspectionDb,
  drawingId: string,
  position: number,
  now = Date.now(),
): Promise<number> {
  return db.transaction(
    "rw",
    [db.inspections, db.drawings, db.items, db.observationBoxes, db.markups],
    async () => {
      const drawing = await db.drawings.get(drawingId);
      if (!drawing) throw new Error(`Drawing ${drawingId} not found`);
      const pages = pagesOf(drawing);
      const original = pages[position - 1];
      if (!original) throw new Error(`No page ${position} on ${drawing.name}`);
      const next = [
        ...pages.slice(0, position),
        // A copy of a page moved in still shows the other drawing's PDF.
        original.from
          ? { source: original.source, from: original.from }
          : { source: original.source },
        ...pages.slice(position),
      ];
      await db.drawings.update(drawingId, { pages: next });
      await db.items
        .where("drawingId")
        .equals(drawingId)
        .filter((item) => item.page > position)
        .modify((item) => {
          item.page += 1;
        });
      await db.observationBoxes
        .filter((box) => box.drawingId === drawingId && box.page > position)
        .modify((box) => {
          box.page += 1;
        });
      await db.markups
        .where("drawingId")
        .equals(drawingId)
        .filter((mark) => mark.page > position)
        .modify((mark) => {
          mark.page += 1;
        });
      await remapCopies(db, drawing.inspectionId, drawingId, (page) =>
        page > position ? page + 1 : page,
      );
      await reletterInspection(db, drawing.inspectionId);
      await touchInspection(db, drawing.inspectionId, now);
      return position + 1;
    },
  );
}

/**
 * Where a page lands when moved one visible page earlier (-1) or later
 * (1) within its drawing (hidden pages are stepped over); null when it is
 * already first or last.
 */
export function pageMoveTarget(
  pages: DrawingPage[],
  position: number,
  direction: -1 | 1,
): number | null {
  for (
    let i = position - 1 + direction;
    i >= 0 && i < pages.length;
    i += direction
  )
    if (!pages[i].hidden) return i + 1;
  return null;
}

/** Where a page goes: a drawing and a 1-based position in its pages. */
interface Spot {
  drawingId: string;
  page: number;
}

/**
 * Moves every page reference (items and their copies, notes boxes, markup)
 * of an inspection through `remap`, which returns where a drawing's page
 * now is (or null to leave it).
 */
async function remapPages(
  db: InspectionDb,
  inspectionId: string,
  drawingIds: string[],
  remap: (spot: Spot) => Spot | null,
): Promise<void> {
  const moved = (spot: Spot) => remap(spot) ?? spot;
  await db.items
    .where("inspectionId")
    .equals(inspectionId)
    .modify((item) => {
      if (drawingIds.includes(item.drawingId)) {
        const to = moved(item);
        item.drawingId = to.drawingId;
        item.page = to.page;
      }
      if (item.copies?.some((c) => drawingIds.includes(c.drawingId)))
        item.copies = item.copies.map((c) =>
          drawingIds.includes(c.drawingId) ? { ...c, ...moved(c) } : c,
        );
    });
  await db.observationBoxes
    .filter((box) => drawingIds.includes(box.drawingId))
    .modify((box) => {
      const to = moved(box);
      box.drawingId = to.drawingId;
      box.page = to.page;
    });
  await db.markups
    .where("drawingId")
    .anyOf(drawingIds)
    .modify((mark) => {
      const to = moved(mark);
      mark.drawingId = to.drawingId;
      mark.page = to.page;
    });
}

/**
 * Moves a page to `toPosition` (1-based, its place once moved) in any of
 * the inspection's drawings, its own included (engineer, 2026-10-16:
 * pages can move between drawings). Its pins, notes box and markup go with
 * it; letters follow the new order. A page moved into another drawing
 * keeps showing its own PDF page (`from`) and then belongs to that
 * drawing (it moves with it when drawings are reordered). Returns where
 * it landed.
 */
export async function movePageTo(
  db: InspectionDb,
  drawingId: string,
  position: number,
  toDrawingId: string,
  toPosition: number,
  now = Date.now(),
): Promise<Spot> {
  return db.transaction(
    "rw",
    [db.inspections, db.drawings, db.items, db.observationBoxes, db.markups],
    async () => {
      const here = { drawingId, page: position };
      const drawing = await db.drawings.get(drawingId);
      const target = await db.drawings.get(toDrawingId);
      if (!drawing || !target) return here;
      const pages = pagesOf(drawing);
      const page = pages[position - 1];
      if (!page) return here;
      if (toDrawingId === drawingId) {
        const to = Math.min(Math.max(1, toPosition), pages.length);
        if (to === position) return here;
        // Old positions in their new order.
        const order = pages.map((_, i) => i + 1);
        order.splice(position - 1, 1);
        order.splice(to - 1, 0, position);
        const newPosition = new Map(order.map((old, i) => [old, i + 1]));
        await db.drawings.update(drawingId, {
          pages: order.map((old) => pages[old - 1]),
        });
        await remapPages(db, drawing.inspectionId, [drawingId], (spot) => ({
          drawingId,
          page: newPosition.get(spot.page) ?? spot.page,
        }));
      } else {
        const targetPages = pagesOf(target);
        const to = Math.min(Math.max(1, toPosition), targetPages.length + 1);
        const moved: DrawingPage = {
          ...page,
          from: pdfDrawingOf(drawingId, page),
        };
        // Back in its own drawing: its own PDF again.
        if (moved.from === toDrawingId) delete moved.from;
        await db.drawings.update(drawingId, {
          pages: pages.filter((_, i) => i !== position - 1),
        });
        await db.drawings.update(toDrawingId, {
          pages: [
            ...targetPages.slice(0, to - 1),
            moved,
            ...targetPages.slice(to - 1),
          ],
        });
        await remapPages(
          db,
          drawing.inspectionId,
          [drawingId, toDrawingId],
          (spot) => {
            if (spot.drawingId === drawingId) {
              if (spot.page === position)
                return { drawingId: toDrawingId, page: to };
              return spot.page > position
                ? { drawingId, page: spot.page - 1 }
                : null;
            }
            return spot.page >= to
              ? { drawingId: toDrawingId, page: spot.page + 1 }
              : null;
          },
        );
      }
      await reletterInspection(db, drawing.inspectionId);
      await touchInspection(db, drawing.inspectionId, now);
      return {
        drawingId: toDrawingId,
        page:
          toDrawingId === drawingId
            ? Math.min(Math.max(1, toPosition), pages.length)
            : Math.min(Math.max(1, toPosition), pagesOf(target).length + 1),
      };
    },
  );
}

/**
 * Moves a page within its drawing, past the next visible page in that
 * direction. Its pins, notes box and markup go with it, and letters follow the new
 * page order. Returns the page's new position (unchanged if it can't move).
 */
export async function movePage(
  db: InspectionDb,
  drawingId: string,
  position: number,
  direction: -1 | 1,
  now = Date.now(),
): Promise<number> {
  const drawing = await db.drawings.get(drawingId);
  if (!drawing) return position;
  const target = pageMoveTarget(pagesOf(drawing), position, direction);
  if (target === null) return position;
  return (await movePageTo(db, drawingId, position, drawingId, target, now))
    .page;
}

/**
 * Removes pages of a drawing with what's on them: their notes boxes and
 * markup, and pins (an item pinned elsewhere too carries on from its next
 * pin; otherwise it goes, with its photos). Later pages move up. For pages
 * moved in from a drawing being deleted (its PDF goes). Run inside a
 * transaction with drawings, items, photos, blobs, notes boxes and markup;
 * the caller re-letters.
 */
export async function removePages(
  db: InspectionDb,
  drawing: Drawing,
  positions: number[],
  drawingOrder: string[],
): Promise<void> {
  const removed = new Set(positions);
  if (removed.size === 0) return;
  const gone = (spot: Spot) =>
    spot.drawingId === drawing.id && removed.has(spot.page);
  const items = await db.items
    .where("inspectionId")
    .equals(drawing.inspectionId)
    .toArray();
  const doomed: Item[] = [];
  for (const item of items) {
    if (gone(item)) {
      const promoted = promoteCopy(item, drawingOrder, gone);
      if (promoted) await db.items.put(promoted);
      else doomed.push(item);
    } else if (item.copies?.some(gone))
      await db.items.update(item.id, {
        copies: item.copies.filter((c) => !gone(c)),
      });
  }
  await deleteItemRecords(db, doomed);
  await db.observationBoxes.filter(gone).delete();
  await db.markups.where("drawingId").equals(drawing.id).filter(gone).delete();
  await db.drawings.update(drawing.id, {
    pages: pagesOf(drawing).filter((_, i) => !removed.has(i + 1)),
  });
  const before = (page: number) => positions.filter((p) => p < page).length;
  await remapPages(db, drawing.inspectionId, [drawing.id], (spot) => ({
    drawingId: drawing.id,
    page: spot.page - before(spot.page),
  }));
}

/** How many visible pages across an inspection's drawings have no pins or markup. */
export function countUnmarked(
  drawings: Drawing[],
  items: Item[],
  marks: Pick<Markup, "drawingId" | "page">[] = [],
): number {
  let count = 0;
  for (const drawing of drawings) {
    const marked = markedPositions(drawing.id, items, marks);
    pagesOf(drawing).forEach((page, i) => {
      if (!page.hidden && !marked.has(i + 1)) count++;
    });
  }
  return count;
}

/** Hides every visible page without pins or markup in an inspection; returns how many. */
export async function hideUnmarkedPages(
  db: InspectionDb,
  inspectionId: string,
  now = Date.now(),
): Promise<number> {
  const drawings = await db.drawings
    .where("inspectionId")
    .equals(inspectionId)
    .toArray();
  let count = 0;
  for (const drawing of drawings) {
    const positions = pagesOf(drawing).map((_, i) => i + 1);
    count += await setPagesHidden(db, drawing.id, positions, true, now);
  }
  return count;
}
