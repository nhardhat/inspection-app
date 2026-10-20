import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { northrop } from "../../../brand/northrop";
import { addDrawing, listDrawings } from "../../../db/drawings";
import { createInspection } from "../../../db/inspections";
import { createItem } from "../../../db/items";
import { InspectionDb } from "../../../db/schema";
import type { Inspection } from "../../../db/types";
import {
  addSketchPage,
  changeSketchPage,
  deleteSketchPage,
} from "./sketchPages";

const read = (url: string) => new Uint8Array(readFileSync(fileURLToPath(url)));
const assets = async () => ({
  regular: read(northrop.assets.fonts.regular),
  semiBold: read(northrop.assets.fonts.semiBold),
  wordmark: read(northrop.assets.wordmarkMaroon),
});

let db: InspectionDb;
let inspection: Inspection;

beforeEach(async () => {
  db = new InspectionDb(`test-${crypto.randomUUID()}`);
  inspection = await createInspection(db, new Date(2026, 9, 20));
});
afterEach(async () => {
  await db.delete();
});

async function set(pages = 2) {
  return addDrawing(db, inspection.id, {
    name: "S-101",
    pdf: new TextEncoder().encode("%PDF"),
    pageCount: pages,
    pageSizes: Array.from(
      { length: pages },
      () => [2384, 1684] as [number, number],
    ),
  });
}

describe("sketch pages", () => {
  test("added after a page, numbered, in the export, pins stay with it", async () => {
    const d = await set(2);
    const sheet = {
      size: "A3",
      orientation: "landscape",
      scale: "1:50",
    } as const;
    expect(
      await addSketchPage(
        db,
        inspection.id,
        { drawingId: d.id, position: 1 },
        sheet,
        assets,
      ),
    ).toEqual({ drawingId: d.id, page: 2 });
    await addSketchPage(
      db,
      inspection.id,
      { drawingId: d.id, position: 2 },
      sheet,
      assets,
    );
    const pages = (await db.drawings.get(d.id))!.pages;
    expect(
      pages.map((p) => [p.source, Boolean(p.from), p.include ?? false]),
    ).toEqual([
      [1, false, false],
      [1, true, true],
      [1, true, true],
      [2, false, false],
    ]);
    const sketches = (await listDrawings(db, inspection.id)).filter(
      (x) => x.sketch,
    );
    expect(
      sketches.map((s) => [s.name, s.sketch!.number, s.pages.length]),
    ).toEqual([
      ["Sketch SK01", 1, 0],
      ["Sketch SK02", 2, 0],
    ]);

    // A pin on SK01, then a new sheet for it: the pin stays.
    const pin = await createItem(
      db,
      { inspectionId: inspection.id, drawingId: d.id, page: 2, x: 0.5, y: 0.5 },
      { x: 0.6, y: 0.02 },
    );
    const sk1 = sketches[0];
    await changeSketchPage(
      db,
      sk1.id,
      { size: "A4", orientation: "portrait", scale: "NTS" },
      assets,
    );
    expect(await db.drawings.get(sk1.id)).toBeUndefined();
    const fresh = (await listDrawings(db, inspection.id)).find(
      (x) => x.sketch?.number === 1,
    )!;
    expect(fresh.sketch).toMatchObject({ size: "A4", scale: "NTS" });
    expect((await db.drawings.get(d.id))!.pages[1].from).toBe(fresh.id);
    expect((await db.items.get(pin.id))!.page).toBe(2);

    // Deleting it takes its page and pin.
    await deleteSketchPage(db, fresh.id);
    expect((await db.drawings.get(d.id))!.pages).toHaveLength(3);
    expect(await db.items.get(pin.id)).toBeUndefined();
  });
});
