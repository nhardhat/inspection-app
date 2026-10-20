import { indexForLetter, letterForIndex } from "../features/items/letters";
import { isOnPage, itemSpots } from "../features/items/spots";
import type { InspectionDb } from "./schema";
import { photoBlobIds } from "./types";
import type {
  Item,
  ItemArrow,
  ItemKind,
  ObservationBox,
  Photo,
  PinCopy,
  StoredBlob,
} from "./types";

export interface NewItem {
  inspectionId: string;
  drawingId: string;
  page: number;
  x: number;
  y: number;
  /** Arrows placed with the pin (a hold and drag). */
  arrows?: ItemArrow[];
  /** Instruction unless given (a double-tap and hold places an observation). */
  kind?: ItemKind;
}

/** Fields the item sheet and pin dragging can change. */
export type ItemPatch = Partial<
  Pick<
    Item,
    "kind" | "text" | "requiresPhotoConfirmation" | "x" | "y" | "arrows"
  >
>;

/** Marks the inspection as changed (drives "Edited ..." on the list). */
export async function touchInspection(
  db: InspectionDb,
  inspectionId: string,
  now = Date.now(),
): Promise<void> {
  await db.inspections.update(inspectionId, { updatedAt: now });
}

/**
 * Creates an instruction item, lettered by its place in the document (which
 * may re-letter pins further on). The first pin on a page also creates that
 * page's notes box at `boxPosition`.
 */
export async function createItem(
  db: InspectionDb,
  item: NewItem,
  boxPosition: { x: number; y: number },
  now = Date.now(),
): Promise<Item> {
  return db.transaction(
    "rw",
    [db.inspections, db.drawings, db.items, db.observationBoxes],
    async () => {
      const inspection = await db.inspections.get(item.inspectionId);
      if (!inspection)
        throw new Error(`Inspection ${item.inspectionId} not found`);
      const existing = await db.items
        .where("inspectionId")
        .equals(item.inspectionId)
        .toArray();
      const created: Item = {
        id: crypto.randomUUID(),
        ...item,
        // Placeholder until re-lettered below.
        letter: letterForIndex(existing.length),
        kind: item.kind ?? ("instruction" satisfies ItemKind),
        text: "",
        requiresPhotoConfirmation: false,
        photoIds: [],
        // Strictly after every other item, so creation order never ties.
        createdAt: Math.max(
          now,
          ...existing.map((other) => other.createdAt + 1),
        ),
        sequence: 0,
        arrows: item.arrows ?? [],
      };
      // Placed last on its page.
      created.sequence = created.createdAt;
      await db.items.add(created);
      await reletterInspection(db, item.inspectionId);
      await touchInspection(db, item.inspectionId, now);
      const box = await db.observationBoxes
        .where("[drawingId+page]")
        .equals([item.drawingId, item.page])
        .first();
      if (!box) {
        await db.observationBoxes.add({
          id: crypto.randomUUID(),
          drawingId: item.drawingId,
          page: item.page,
          ...boxPosition,
        });
      }
      return (await db.items.get(created.id))!;
    },
  );
}

/**
 * Adds a general note: an observation with no pin, listed in every notes
 * box and lettered before the pinned observations.
 */
export async function createGeneralNote(
  db: InspectionDb,
  inspectionId: string,
  now = Date.now(),
  init: Pick<Item, "text" | "fromType"> = { text: "" },
): Promise<Item> {
  return db.transaction(
    "rw",
    [db.inspections, db.drawings, db.items],
    async () => {
      const existing = await db.items
        .where("inspectionId")
        .equals(inspectionId)
        .toArray();
      const createdAt = Math.max(
        now,
        ...existing.map((other) => other.createdAt + 1),
      );
      const created: Item = {
        id: crypto.randomUUID(),
        inspectionId,
        drawingId: "",
        page: 0,
        x: 0,
        y: 0,
        general: true,
        letter: letterForIndex(existing.length),
        kind: "observation",
        ...init,
        requiresPhotoConfirmation: false,
        photoIds: [],
        createdAt,
        // After the other general notes.
        sequence: createdAt,
        arrows: [],
      };
      await db.items.add(created);
      await reletterInspection(db, inspectionId);
      await touchInspection(db, inspectionId, now);
      return (await db.items.get(created.id))!;
    },
  );
}

export async function updateItem(
  db: InspectionDb,
  id: string,
  patch: ItemPatch,
  now = Date.now(),
): Promise<void> {
  await db.transaction(
    "rw",
    [db.inspections, db.drawings, db.items],
    async () => {
      const item = await db.items.get(id);
      if (!item) throw new Error(`Item ${id} not found`);
      // General notes are always observations.
      if (item.general && patch.kind === "instruction") {
        const { kind: _kind, ...rest } = patch;
        void _kind;
        patch = rest;
      }
      await db.items.update(id, patch);
      // Switching kind moves it to the other list: re-letter both.
      if (patch.kind && patch.kind !== item.kind)
        await reletterInspection(db, item.inspectionId);
      await touchInspection(db, item.inspectionId, now);
    },
  );
}

/** Deletes items with their photos and photo images (no transaction of its own). */
export async function deleteItemRecords(
  db: InspectionDb,
  items: Item[],
): Promise<void> {
  const photoIds = items.flatMap((item) => item.photoIds);
  const photos = (await db.photos.bulkGet(photoIds)).filter(
    (p) => p !== undefined,
  );
  await db.blobs.bulkDelete(photos.flatMap(photoBlobIds));
  await db.photos.bulkDelete(photoIds);
  await db.items.bulkDelete(items.map((item) => item.id));
}

/**
 * Letters for items, per kind: instructions A, B, C... and observations
 * A, B, C... each in document order (drawing order, then page, then the
 * item's sequence on the page: placement order unless reordered), with no
 * gaps. `drawingOrder` lists
 * the inspection's drawing ids in document order. Returns only the items
 * whose letter changes.
 */
export function letterChanges(
  items: Item[],
  drawingOrder: string[],
): { id: string; letter: string }[] {
  const rank = new Map(drawingOrder.map((id, i) => [id, i]));
  // General notes come first (engineer, 2026-10-07), then the pins.
  const drawingRank = (item: Item) =>
    item.general ? -1 : (rank.get(item.drawingId) ?? Infinity);
  const changes: { id: string; letter: string }[] = [];
  for (const kind of ["instruction", "observation"] as const) {
    const ofKind = items
      .filter((item) => item.kind === kind)
      .sort(
        (a, b) =>
          drawingRank(a) - drawingRank(b) ||
          a.page - b.page ||
          a.sequence - b.sequence ||
          indexForLetter(a.letter) - indexForLetter(b.letter),
      );
    for (const [index, item] of ofKind.entries()) {
      const letter = letterForIndex(index);
      if (item.letter !== letter) changes.push({ id: item.id, letter });
    }
  }
  return changes;
}

/**
 * Re-letters an inspection's items (see letterChanges). Run inside a
 * transaction that includes drawings and items.
 */
export async function reletterInspection(
  db: InspectionDb,
  inspectionId: string,
): Promise<void> {
  const [items, drawings] = await Promise.all([
    db.items.where("inspectionId").equals(inspectionId).toArray(),
    db.drawings.where("inspectionId").equals(inspectionId).toArray(),
  ]);
  drawings.sort((a, b) => a.createdAt - b.createdAt);
  const order = drawings.map((d) => d.id);
  for (const { id, letter } of letterChanges(items, order))
    await db.items.update(id, { letter });
}

/** Everything deleteItem removed, so restoreItem can put it back exactly. */
export interface DeletedItem {
  item: Item;
  photos: Photo[];
  blobs: StoredBlob[];
  /** Notes boxes of pages where it (or a copy) was the last pin. */
  boxes: ObservationBox[];
}

/**
 * Deletes an item and its photos, then re-letters the rest so there are no
 * gaps (delete C and D becomes C). The page's notes box goes when its last
 * pin does. Returns what was removed (for undo), or null if not found.
 */
export async function deleteItem(
  db: InspectionDb,
  id: string,
  now = Date.now(),
): Promise<DeletedItem | null> {
  return db.transaction(
    "rw",
    [
      db.inspections,
      db.drawings,
      db.items,
      db.photos,
      db.blobs,
      db.observationBoxes,
    ],
    async () => {
      const item = await db.items.get(id);
      if (!item) return null;
      const photos = (await db.photos.bulkGet(item.photoIds)).filter(
        (p) => p !== undefined,
      );
      const blobs = (
        await db.blobs.bulkGet(photos.flatMap(photoBlobIds))
      ).filter((b) => b !== undefined);
      await deleteItemRecords(db, [item]);
      const boxes: ObservationBox[] = [];
      for (const spot of itemSpots(item)) {
        const box = await removeBoxIfEmpty(
          db,
          item.inspectionId,
          spot.drawingId,
          spot.page,
        );
        if (box) boxes.push(box);
      }
      await reletterInspection(db, item.inspectionId);
      await touchInspection(db, item.inspectionId, now);
      return { item, photos, blobs, boxes };
    },
  );
}

/**
 * Puts a deleted item back (undo) with its photos and notes box, then
 * re-letters. Does nothing if its drawing has since been deleted.
 */
export async function restoreItem(
  db: InspectionDb,
  deleted: DeletedItem,
  now = Date.now(),
): Promise<void> {
  await db.transaction(
    "rw",
    [
      db.inspections,
      db.drawings,
      db.items,
      db.photos,
      db.blobs,
      db.observationBoxes,
    ],
    async () => {
      const { item } = deleted;
      if (!(await db.drawings.get(item.drawingId))) return;
      await db.blobs.bulkPut(deleted.blobs);
      await db.photos.bulkPut(deleted.photos);
      // Copies on drawings deleted since are left out.
      const drawingIds = new Set(
        (await db.drawings
          .where("inspectionId")
          .equals(item.inspectionId)
          .primaryKeys()) as string[],
      );
      await db.items.put({
        ...item,
        copies: item.copies?.filter((c) => drawingIds.has(c.drawingId)),
      });
      for (const box of deleted.boxes) {
        if (!drawingIds.has(box.drawingId)) continue;
        const existing = await db.observationBoxes
          .where("[drawingId+page]")
          .equals([box.drawingId, box.page])
          .first();
        if (!existing) await db.observationBoxes.put(box);
      }
      await reletterInspection(db, item.inspectionId);
      await touchInspection(db, item.inspectionId, now);
    },
  );
}

/**
 * Reorders items of one kind on one page: `ids` in their new order. Their
 * sequence numbers are shared out again in that order, then everything is
 * re-lettered. Returns the previous order (for undo).
 */
export async function reorderItems(
  db: InspectionDb,
  ids: string[],
  now = Date.now(),
): Promise<string[]> {
  return db.transaction(
    "rw",
    [db.inspections, db.drawings, db.items],
    async () => {
      const items = (await db.items.bulkGet(ids)).filter(
        (item) => item !== undefined,
      );
      const previous = [...items].sort((a, b) => a.sequence - b.sequence);
      if (items.length < 2) return previous.map((item) => item.id);
      const [first] = items;
      const samePage = items.every(
        (item) =>
          item.inspectionId === first.inspectionId &&
          item.kind === first.kind &&
          item.drawingId === first.drawingId &&
          item.page === first.page,
      );
      if (!samePage)
        throw new Error("Only items of one kind on one page can be reordered");
      const slots = previous.map((item) => item.sequence);
      const present = ids.filter((id) => items.some((item) => item.id === id));
      for (const [i, id] of present.entries())
        await db.items.update(id, { sequence: slots[i] });
      await reletterInspection(db, first.inspectionId);
      await touchInspection(db, first.inspectionId, now);
      return previous.map((item) => item.id);
    },
  );
}

/**
 * Puts a page's notes box at `to`, making its record if the page had none
 * yet (a page with only general notes shows one at the default spot).
 */
/**
 * Saves a page's notes box: where it is (`x`, `y`), and its width and text
 * size if changed (undefined clears them back to the default). Creates its
 * record if the page had none.
 */
export async function placeObservationBox(
  db: InspectionDb,
  drawingId: string,
  page: number,
  to: Pick<ObservationBox, "x" | "y" | "width" | "textSize">,
  inspectionId: string,
  now = Date.now(),
): Promise<void> {
  await db.transaction(
    "rw",
    [db.inspections, db.observationBoxes],
    async () => {
      const box = await db.observationBoxes
        .where("[drawingId+page]")
        .equals([drawingId, page])
        .first();
      if (box) await db.observationBoxes.update(box.id, to);
      else
        await db.observationBoxes.add({
          id: crypto.randomUUID(),
          drawingId,
          page,
          ...to,
        });
      await touchInspection(db, inspectionId, now);
    },
  );
}

export async function moveObservationBox(
  db: InspectionDb,
  id: string,
  to: { x: number; y: number },
  inspectionId: string,
  now = Date.now(),
): Promise<void> {
  await db.transaction(
    "rw",
    [db.inspections, db.observationBoxes],
    async () => {
      await db.observationBoxes.update(id, to);
      await touchInspection(db, inspectionId, now);
    },
  );
}

/** Whether any item of the inspection has a pin (or copy) on a page. */
export async function pageHasPins(
  db: InspectionDb,
  inspectionId: string,
  drawingId: string,
  page: number,
): Promise<boolean> {
  const items = await db.items
    .where("inspectionId")
    .equals(inspectionId)
    .toArray();
  return items.some((item) => isOnPage(item, drawingId, page));
}

/**
 * Removes a page's notes box once it has no pins (kept, where it was put,
 * while there are general notes to list); returns it (for undo).
 */
async function removeBoxIfEmpty(
  db: InspectionDb,
  inspectionId: string,
  drawingId: string,
  page: number,
): Promise<ObservationBox | null> {
  if (await pageHasPins(db, inspectionId, drawingId, page)) return null;
  const general = await db.items
    .where("inspectionId")
    .equals(inspectionId)
    .filter((item) => item.general === true)
    .count();
  if (general > 0) return null;
  const pageBox = db.observationBoxes
    .where("[drawingId+page]")
    .equals([drawingId, page]);
  const box = (await pageBox.first()) ?? null;
  await pageBox.delete();
  return box;
}

/** Gives a page a notes box (at `position`) if it has none. */
async function ensureBox(
  db: InspectionDb,
  drawingId: string,
  page: number,
  position: { x: number; y: number },
): Promise<void> {
  const box = await db.observationBoxes
    .where("[drawingId+page]")
    .equals([drawingId, page])
    .first();
  if (!box)
    await db.observationBoxes.add({
      id: crypto.randomUUID(),
      drawingId,
      page,
      ...position,
    });
}

const COPY_TABLES = (db: InspectionDb) => [
  db.inspections,
  db.drawings,
  db.items,
  db.observationBoxes,
];

/**
 * Pins the item at another spot (Copy pin): same letter, text and photos.
 * Copies never re-letter anything. The first pin on a page also creates
 * its notes box at `boxPosition`.
 */
export async function addCopy(
  db: InspectionDb,
  itemId: string,
  spot: { drawingId: string; page: number; x: number; y: number },
  boxPosition: { x: number; y: number },
  now = Date.now(),
): Promise<PinCopy> {
  return db.transaction("rw", COPY_TABLES(db), async () => {
    const item = await db.items.get(itemId);
    if (!item) throw new Error(`Item ${itemId} not found`);
    const copy: PinCopy = { id: crypto.randomUUID(), ...spot, arrows: [] };
    await db.items.update(itemId, { copies: [...(item.copies ?? []), copy] });
    await ensureBox(db, spot.drawingId, spot.page, boxPosition);
    await touchInspection(db, item.inspectionId, now);
    return copy;
  });
}

/** What removeCopy took away, so restoreCopy can put it back. */
export interface RemovedCopy {
  itemId: string;
  copy: PinCopy;
  /** Its place in the item's copies. */
  index: number;
  /** The page's notes box, if the copy was its last pin. */
  box: ObservationBox | null;
}

/** Removes one copy (the item and its other spots stay). */
export async function removeCopy(
  db: InspectionDb,
  itemId: string,
  copyId: string,
  now = Date.now(),
): Promise<RemovedCopy | null> {
  return db.transaction("rw", COPY_TABLES(db), async () => {
    const item = await db.items.get(itemId);
    const copies = item?.copies ?? [];
    const index = copies.findIndex((c) => c.id === copyId);
    if (!item || index < 0) return null;
    const copy = copies[index];
    await db.items.update(itemId, {
      copies: copies.filter((c) => c.id !== copyId),
    });
    const box = await removeBoxIfEmpty(
      db,
      item.inspectionId,
      copy.drawingId,
      copy.page,
    );
    await touchInspection(db, item.inspectionId, now);
    return { itemId, copy, index, box };
  });
}

/** Puts a removed copy back (undo), unless its item or drawing has gone. */
export async function restoreCopy(
  db: InspectionDb,
  removed: RemovedCopy,
  now = Date.now(),
): Promise<void> {
  await db.transaction("rw", COPY_TABLES(db), async () => {
    const item = await db.items.get(removed.itemId);
    if (!item || !(await db.drawings.get(removed.copy.drawingId))) return;
    const copies = [...(item.copies ?? [])].filter(
      (c) => c.id !== removed.copy.id,
    );
    copies.splice(removed.index, 0, removed.copy);
    await db.items.update(item.id, { copies });
    const { drawingId, page } = removed.copy;
    if (removed.box) await ensureBox(db, drawingId, page, removed.box);
    await touchInspection(db, item.inspectionId, now);
  });
}

/** Moves a copy or changes its arrows. */
export async function updateCopy(
  db: InspectionDb,
  itemId: string,
  copyId: string,
  patch: Partial<Pick<PinCopy, "x" | "y" | "arrows">>,
  now = Date.now(),
): Promise<void> {
  await db.transaction("rw", [db.inspections, db.items], async () => {
    const item = await db.items.get(itemId);
    if (!item) return;
    await db.items.update(itemId, {
      copies: (item.copies ?? []).map((c) =>
        c.id === copyId ? { ...c, ...patch } : c,
      ),
    });
    await touchInspection(db, item.inspectionId, now);
  });
}

/**
 * The item with its first copy in document order (drawing order, then
 * page, then placement) made the original pin, leaving out copies on
 * `skip` (a drawing, or which copies). Null when there is no copy to
 * promote.
 */
export function promoteCopy(
  item: Item,
  drawingOrder: string[],
  skip?: string | ((copy: { drawingId: string; page: number }) => boolean),
): Item | null {
  const rank = (id: string) => {
    const i = drawingOrder.indexOf(id);
    return i < 0 ? Infinity : i;
  };
  const skipped =
    typeof skip === "function"
      ? skip
      : (c: { drawingId: string }) => c.drawingId === skip;
  const candidates = (item.copies ?? []).filter((c) => !skipped(c));
  if (candidates.length === 0) return null;
  const first = [...candidates].sort(
    (a, b) => rank(a.drawingId) - rank(b.drawingId) || a.page - b.page,
  )[0];
  return {
    ...item,
    drawingId: first.drawingId,
    page: first.page,
    x: first.x,
    y: first.y,
    arrows: first.arrows,
    // Last on its new page, like a new pin.
    sequence: Date.now(),
    copies: candidates.filter((c) => c.id !== first.id),
  };
}

/** An inspection's drawing ids in document order. */
async function drawingOrder(
  db: InspectionDb,
  inspectionId: string,
): Promise<string[]> {
  const drawings = await db.drawings
    .where("inspectionId")
    .equals(inspectionId)
    .toArray();
  return drawings.sort((a, b) => a.createdAt - b.createdAt).map((d) => d.id);
}

/** What removeOriginalSpot changed, for undo. */
export interface RemovedOriginal {
  before: Item;
  box: ObservationBox | null;
}

/**
 * Removes an item's original pin when it has copies: the first copy in
 * document order becomes the original (its place decides the letter, so
 * letters may change). Null when there's no copy to promote.
 */
export async function removeOriginalSpot(
  db: InspectionDb,
  itemId: string,
  now = Date.now(),
): Promise<RemovedOriginal | null> {
  return db.transaction("rw", COPY_TABLES(db), async () => {
    const item = await db.items.get(itemId);
    if (!item) return null;
    const promoted = promoteCopy(
      item,
      await drawingOrder(db, item.inspectionId),
    );
    if (!promoted) return null;
    await db.items.put(promoted);
    const box = await removeBoxIfEmpty(
      db,
      item.inspectionId,
      item.drawingId,
      item.page,
    );
    await reletterInspection(db, item.inspectionId);
    await touchInspection(db, item.inspectionId, now);
    return { before: item, box };
  });
}

/** Undoes removeOriginalSpot. */
export async function restoreOriginalSpot(
  db: InspectionDb,
  removed: RemovedOriginal,
  now = Date.now(),
): Promise<void> {
  await db.transaction("rw", COPY_TABLES(db), async () => {
    const { before } = removed;
    const current = await db.items.get(before.id);
    if (!current || !(await db.drawings.get(before.drawingId))) return;
    // Keep text, kind and photos as they are now; put the spots back.
    await db.items.put({
      ...current,
      drawingId: before.drawingId,
      page: before.page,
      x: before.x,
      y: before.y,
      arrows: before.arrows,
      sequence: before.sequence,
      copies: before.copies,
    });
    if (removed.box)
      await ensureBox(db, before.drawingId, before.page, removed.box);
    await reletterInspection(db, before.inspectionId);
    await touchInspection(db, before.inspectionId, now);
  });
}
