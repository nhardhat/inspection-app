import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  addDrawing,
  deleteDrawing,
  listDrawings,
  moveDrawing,
  reorderDrawings,
} from "./drawings";
import { createInspection } from "./inspections";
import { addCopy, createItem } from "./items";
import {
  countUnmarked,
  duplicatePage,
  hideUnmarkedPages,
  movePage,
  movePageTo,
  pageMoveTarget,
  setPagesHidden,
  setPagesIncluded,
} from "./pages";
import { InspectionDb } from "./schema";
import type { Inspection } from "./types";

let db: InspectionDb;
let inspection: Inspection;
const BOX = { x: 0.6, y: 0.02 };

beforeEach(async () => {
  db = new InspectionDb(`test-${crypto.randomUUID()}`);
  inspection = await createInspection(db, new Date(2026, 9, 1));
});

afterEach(async () => {
  await db.delete();
});

async function drawing(pageCount = 3) {
  return addDrawing(db, inspection.id, {
    name: "S-101",
    pdf: new TextEncoder().encode("%PDF"),
    pageCount,
    pageSizes: Array.from(
      { length: pageCount },
      () => [2384, 1684] as [number, number],
    ),
  });
}

function pin(drawingId: string, page: number, x = 0.5) {
  return createItem(
    db,
    { inspectionId: inspection.id, drawingId, page, x, y: 0.5 },
    BOX,
  );
}

describe("drawing pages", () => {
  test("a new drawing lists each PDF page once", async () => {
    const d = await drawing(3);
    expect(d.pages).toEqual([{ source: 1 }, { source: 2 }, { source: 3 }]);
  });

  test("hiding skips pages with pins; restoring brings pages back", async () => {
    const d = await drawing(3);
    await pin(d.id, 2);
    expect(await setPagesHidden(db, d.id, [1, 2, 3], true)).toBe(2);
    expect((await db.drawings.get(d.id))!.pages).toEqual([
      { source: 1, hidden: true },
      { source: 2 },
      { source: 3, hidden: true },
    ]);
    expect(await setPagesHidden(db, d.id, [3], false)).toBe(1);
    expect((await db.drawings.get(d.id))!.pages[2]).toEqual({ source: 3 });
  });

  test("duplicating puts a copy after the page and moves later pins along", async () => {
    const d = await drawing(3);
    const onOne = await pin(d.id, 1);
    const onThree = await pin(d.id, 3);
    await db.observationBoxes.add({
      id: "box3",
      drawingId: d.id,
      page: 3,
      ...BOX,
    });

    expect(await duplicatePage(db, d.id, 2)).toBe(3);
    expect((await db.drawings.get(d.id))!.pages).toEqual([
      { source: 1 },
      { source: 2 },
      { source: 2 },
      { source: 3 },
    ]);
    expect((await db.items.get(onOne.id))!.page).toBe(1);
    expect((await db.items.get(onThree.id))!.page).toBe(4);
    expect((await db.observationBoxes.get("box3"))!.page).toBe(4);
  });

  test("pages can be ticked for the export and unticked", async () => {
    const d = await drawing(2);
    expect(await setPagesIncluded(db, d.id, [2], true)).toBe(1);
    expect(await setPagesIncluded(db, d.id, [2], true)).toBe(0);
    expect((await db.drawings.get(d.id))!.pages[1]).toEqual({
      source: 2,
      include: true,
    });
    await setPagesIncluded(db, d.id, [2], false);
    expect((await db.drawings.get(d.id))!.pages[1]).toEqual({ source: 2 });
  });

  test("a duplicate of a pinned page starts without pins", async () => {
    const d = await drawing(1);
    await pin(d.id, 1);
    await duplicatePage(db, d.id, 1);
    const items = await db.items.toArray();
    expect(items.map((i) => i.page)).toEqual([1]);
  });

  test("hide unmarked pages hides every visible page without pins", async () => {
    const a = await drawing(3);
    const b = await drawing(2);
    await pin(a.id, 1);
    await pin(b.id, 2);
    const drawings = await db.drawings.toArray();
    expect(countUnmarked(drawings, await db.items.toArray())).toBe(3);
    expect(await hideUnmarkedPages(db, inspection.id)).toBe(3);
    const after = await db.drawings.toArray();
    expect(countUnmarked(after, await db.items.toArray())).toBe(0);
  });
});

describe("moving pages and drawings", () => {
  test("pageMoveTarget steps over hidden pages and stops at the ends", () => {
    const pages = [{ source: 1 }, { source: 2, hidden: true }, { source: 3 }];
    expect(pageMoveTarget(pages, 1, 1)).toBe(3);
    expect(pageMoveTarget(pages, 3, -1)).toBe(1);
    expect(pageMoveTarget(pages, 1, -1)).toBeNull();
    expect(pageMoveTarget(pages, 3, 1)).toBeNull();
  });

  test("a page moves with its pins and notes box; letters follow", async () => {
    const d = await drawing(3);
    const onOne = await pin(d.id, 1);
    const onThree = await pin(d.id, 3);
    expect([onOne.letter, (await db.items.get(onThree.id))!.letter]).toEqual([
      "A",
      "B",
    ]);
    expect(await movePage(db, d.id, 3, -1)).toBe(2);
    expect(await movePage(db, d.id, 2, -1)).toBe(1);
    expect((await db.drawings.get(d.id))!.pages).toEqual([
      { source: 3 },
      { source: 1 },
      { source: 2 },
    ]);
    const [one, three] = await db.items.bulkGet([onOne.id, onThree.id]);
    expect([one!.page, one!.letter]).toEqual([2, "B"]);
    expect([three!.page, three!.letter]).toEqual([1, "A"]);
    const boxes = await db.observationBoxes.toArray();
    expect(boxes.map((b) => b.page).sort()).toEqual([1, 2]);
    // Already first: nothing changes.
    expect(await movePage(db, d.id, 1, -1)).toBe(1);
  });

  test("reordering drawings re-letters in the new document order", async () => {
    const a = await drawing(1);
    const b = await drawing(1);
    const pinA = await pin(a.id, 1);
    const pinB = await pin(b.id, 1);
    await moveDrawing(db, b.id, -1);
    expect((await listDrawings(db, inspection.id)).map((d) => d.id)).toEqual([
      b.id,
      a.id,
    ]);
    const [ia, ib] = await db.items.bulkGet([pinA.id, pinB.id]);
    expect([ia!.letter, ib!.letter]).toEqual(["B", "A"]);
    // A new drawing still goes last.
    const c = await drawing(1);
    expect((await listDrawings(db, inspection.id)).at(-1)!.id).toBe(c.id);
    await reorderDrawings(db, inspection.id, [c.id, a.id, b.id]);
    expect((await listDrawings(db, inspection.id)).map((d) => d.id)).toEqual([
      c.id,
      a.id,
      b.id,
    ]);
    await expect(
      reorderDrawings(db, inspection.id, [a.id, b.id]),
    ).rejects.toThrow();
  });
});

describe("moving pages between drawings (engineer, 2026-10-16)", () => {
  test("a page moves into another drawing with its pins, box and markup", async () => {
    const a = await drawing(3);
    const b = await drawing(2);
    const onA1 = await pin(a.id, 1);
    const onA2 = await pin(a.id, 2);
    const onA3 = await pin(a.id, 3);
    const onB2 = await pin(b.id, 2);
    await db.markups.add({
      id: "mark",
      inspectionId: inspection.id,
      drawingId: a.id,
      page: 2,
      tool: "pen",
      points: [0, 0, 1, 1],
      colour: "#000",
      width: 1,
      createdAt: 1,
    } as never);
    // A2 goes after B1.
    expect(await movePageTo(db, a.id, 2, b.id, 2)).toEqual({
      drawingId: b.id,
      page: 2,
    });
    expect((await db.drawings.get(a.id))!.pages).toEqual([
      { source: 1 },
      { source: 3 },
    ]);
    expect((await db.drawings.get(b.id))!.pages).toEqual([
      { source: 1 },
      { source: 2, from: a.id },
      { source: 2 },
    ]);
    const spots = async (id: string) => {
      const item = (await db.items.get(id))!;
      return [item.drawingId === a.id ? "a" : "b", item.page, item.letter];
    };
    // Document order now: A1, A3, B1, (A2), B2.
    expect(await spots(onA1.id)).toEqual(["a", 1, "A"]);
    expect(await spots(onA3.id)).toEqual(["a", 2, "B"]);
    expect(await spots(onA2.id)).toEqual(["b", 2, "C"]);
    expect(await spots(onB2.id)).toEqual(["b", 3, "D"]);
    const mark = (await db.markups.get("mark"))!;
    expect([mark.drawingId, mark.page]).toEqual([b.id, 2]);
    const boxes = (await db.observationBoxes.toArray())
      .map((box) => `${box.drawingId === a.id ? "a" : "b"}${box.page}`)
      .sort();
    expect(boxes).toEqual(["a1", "a2", "b2", "b3"]);

    // Back home: its own PDF again.
    await movePageTo(db, b.id, 2, a.id, 2);
    expect((await db.drawings.get(a.id))!.pages).toEqual([
      { source: 1 },
      { source: 2 },
      { source: 3 },
    ]);
    expect(await spots(onA2.id)).toEqual(["a", 2, "B"]);
  });

  test("copies follow, and duplicating a moved page keeps its PDF", async () => {
    const a = await drawing(2);
    const b = await drawing(1);
    const item = await pin(b.id, 1);
    await addCopy(
      db,
      item.id,
      { drawingId: a.id, page: 2, x: 0.1, y: 0.1 },
      BOX,
    );
    await movePageTo(db, a.id, 2, b.id, 1);
    const copy = (await db.items.get(item.id))!.copies![0];
    expect([copy.drawingId, copy.page]).toEqual([b.id, 1]);
    expect((await db.items.get(item.id))!.page).toBe(2);
    await duplicatePage(db, b.id, 1);
    expect((await db.drawings.get(b.id))!.pages).toEqual([
      { source: 2, from: a.id },
      { source: 2, from: a.id },
      { source: 1 },
    ]);
  });

  test("deleting a drawing removes its pages moved elsewhere, with their pins", async () => {
    const a = await drawing(2);
    const b = await drawing(2);
    await movePageTo(db, a.id, 2, b.id, 1);
    const onMoved = await pin(b.id, 1);
    const onB = await pin(b.id, 3);
    await deleteDrawing(db, a.id);
    expect((await db.drawings.get(b.id))!.pages).toEqual([
      { source: 1 },
      { source: 2 },
    ]);
    expect(await db.items.get(onMoved.id)).toBeUndefined();
    const kept = (await db.items.get(onB.id))!;
    expect([kept.page, kept.letter]).toEqual([2, "A"]);
    expect(
      (await db.observationBoxes.toArray()).map((box) => box.page),
    ).toEqual([2]);
  });
});
