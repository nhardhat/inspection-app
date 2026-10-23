import "fake-indexeddb/auto";
import { strFromU8, unzipSync } from "fflate";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, test } from "vitest";
import { northrop } from "../../brand/northrop";
import { addDrawing } from "../../db/drawings";
import { createInspection, emptyClient } from "../../db/inspections";
import { createItem, updateItem } from "../../db/items";
import { createMemo } from "../../db/memos";
import { addPhotos } from "../../db/photos";
import { createProject } from "../../db/projects";
import { InspectionDb } from "../../db/schema";
import { ensureSeeded } from "../../db/seed";
import { loadTestMemoAssets } from "../memo/pdf/memoAssets.testutil";
import { loadPackData } from "./packData";
import { buildWordMemo, wordFilename } from "./wordMemo";

let db: InspectionDb;
beforeEach(async () => {
  db = new InspectionDb(`test-${crypto.randomUUID()}`);
  await ensureSeeded(db);
});
afterEach(async () => {
  await db.delete();
});

const read = (url: string) => new Uint8Array(readFileSync(fileURLToPath(url)));

/** A 1 x 1 JPEG. */
const JPEG = Uint8Array.from(
  atob(
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  ),
  (c) => c.charCodeAt(0),
);

test("the memo as Word, with Figtree embedded, without the photos", async () => {
  const project = await createProject(db, {
    jobNumber: "SY000001",
    jobName: "Example Apartments",
    client: { ...emptyClient(), name: "Alex Example" },
  });
  const inspection = await createInspection(
    db,
    new Date(2026, 9, 20),
    project.id,
  );
  await db.inspections.update(inspection.id, {
    itemInspected: "Level 3 slab",
    inspector: "Test Engineer",
  });
  const drawing = await addDrawing(db, inspection.id, {
    name: "S-101",
    pdf: new TextEncoder().encode("%PDF"),
    pageCount: 1,
    pageSizes: [[2384, 1684]],
  });
  const a = await createItem(
    db,
    {
      inspectionId: inspection.id,
      drawingId: drawing.id,
      page: 1,
      x: 0.3,
      y: 0.4,
    },
    { x: 0.6, y: 0.05 },
  );
  await updateItem(db, a.id, {
    text: "Add N12 bar",
    requiresPhotoConfirmation: true,
  });
  await addPhotos(db, { itemId: a.id }, [
    {
      data: JPEG.slice().buffer,
      type: "image/jpeg",
      width: 1600,
      height: 1200,
      takenAt: 0,
      source: "library",
    },
  ]);
  await createMemo(db, inspection.id);
  const data = (await loadPackData(db, inspection.id))!;
  const bytes = await buildWordMemo(data, {
    memo: await loadTestMemoAssets(),
    sidebarFirst: read(northrop.assets.sidebarFirst),
    sidebar: read(northrop.assets.sidebar),
  });
  const zip = unzipSync(bytes);
  const words = strFromU8(zip["word/document.xml"]).replace(/<[^>]+>/g, "");
  for (const s of [
    "Example Apartments",
    "SIM001 – Level 3 slab",
    "Ok to proceed subject to the following. Items marked * to be closed out with photos:",
    "A. Add N12 bar *",
    northrop.disclaimer.lead,
  ])
    expect(words).toContain(s);
  // The photos stay in the PDF pack (engineer, 2026-10-23).
  expect(words).not.toContain("Photo appendix");
  expect(Object.keys(zip).filter((n) => n.endsWith(".jpg"))).toHaveLength(0);
  const headers = Object.keys(zip)
    .filter((n) => /^word\/header\d+\.xml$/.test(n))
    .map((n) => strFromU8(zip[n]))
    .join("");
  expect(headers).toContain(northrop.memoTitle);
  expect(headers).toContain(northrop.officeBlock[0]);
  // Figtree: four faces, and SemiBold.
  expect(Object.keys(zip).filter((n) => n.endsWith(".odttf"))).toHaveLength(5);
  expect(wordFilename(data)).toBe("SY000001-SIM001-A-Level 3 slab.docx");
});
