import "fake-indexeddb/auto";
import { PDFDocument } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { afterEach, beforeEach, expect, test } from "vitest";
import { addDrawing } from "../../db/drawings";
import { createInspection, emptyClient } from "../../db/inspections";
import { createItem, updateItem } from "../../db/items";
import { createMemo } from "../../db/memos";
import { addPhotos } from "../../db/photos";
import { createProject } from "../../db/projects";
import { InspectionDb } from "../../db/schema";
import { ensureSeeded } from "../../db/seed";
import {
  SHEET_SIZES,
  TYPICAL_DRAWING,
  buildSyntheticDrawing,
} from "../drawings/fixtures/syntheticDrawing";
import { loadTestMemoAssets } from "../memo/pdf/memoAssets.testutil";
import { buildPack } from "./buildPack";
import { packSummary, packWarnings } from "./packContents";
import { blobLoader, loadPackData } from "./packData";

let db: InspectionDb;

beforeEach(async () => {
  db = new InspectionDb(`test-${crypto.randomUUID()}`);
  await ensureSeeded(db);
});

afterEach(async () => {
  await db.delete();
});

/** A tiny JPEG header pdf-lib accepts (the test reads text, not pixels). */
const JPEG = Uint8Array.from(
  atob(
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  ),
  (c) => c.charCodeAt(0),
);

const newPhoto = () => ({
  data: JPEG.slice().buffer,
  type: "image/jpeg",
  width: 1600,
  height: 1200,
  takenAt: 0,
  source: "library" as const,
});

async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const texts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const content = await (await pdf.getPage(i)).getTextContent();
    texts.push(
      content.items
        .map((it) => ("str" in it ? it.str : ""))
        .join(" ")
        .replace(/\s+/g, " "),
    );
  }
  await pdf.loadingTask.destroy();
  return texts;
}

test("memo, then pinned drawing pages, then the appendix, numbered through", async () => {
  const project = await createProject(db, {
    jobNumber: "SY000001",
    jobName: "Example Apartments",
    client: {
      ...emptyClient(),
      name: "Alex Example",
      company: "Example Builders",
    },
  });
  const inspection = await createInspection(
    db,
    new Date(2026, 9, 1),
    project.id,
  );
  await db.inspections.update(inspection.id, {
    itemInspected: "Level 3 slab reinforcement",
    inspector: "Test Engineer",
  });
  const pdf = await buildSyntheticDrawing(TYPICAL_DRAWING);
  const drawing = await addDrawing(db, inspection.id, {
    name: "S-101",
    pdf,
    pageCount: 3,
    pageSizes: TYPICAL_DRAWING.map((s) => SHEET_SIZES[s.size]),
  });
  const box = { x: 0.6, y: 0.05 };
  const a = await createItem(
    db,
    {
      inspectionId: inspection.id,
      drawingId: drawing.id,
      page: 1,
      x: 0.3,
      y: 0.4,
    },
    box,
  );
  await updateItem(db, a.id, { text: "Add N12 bar at grid 2/B" });
  const o = await createItem(
    db,
    {
      inspectionId: inspection.id,
      drawingId: drawing.id,
      page: 3,
      x: 0.5,
      y: 0.5,
      kind: "observation",
    },
    box,
  );
  await addPhotos(db, { itemId: a.id }, [newPhoto(), newPhoto()]);
  await addPhotos(db, { inspectionId: inspection.id }, [newPhoto()]);
  await createMemo(db, inspection.id);

  const data = await loadPackData(db, inspection.id);
  expect(data).not.toBeNull();
  expect(packSummary(data!)).toEqual({
    drawingPages: 2,
    includedPages: 0,
    photos: 3,
    appendixPages: 1,
  });
  expect(packWarnings(data!)).toEqual([`Observation A has no text.`]);
  void o;

  const fractions: number[] = [];
  const pack = await buildPack(
    data!,
    await loadTestMemoAssets(),
    blobLoader(db),
    (p) => fractions.push(p.fraction),
  );
  expect(pack.filename).toBe(
    "SY000001-SIM001-A-Level 3 slab reinforcement.pdf",
  );
  expect(pack.pages).toBe(4);
  expect(fractions[fractions.length - 1]).toBe(1);

  const doc = await PDFDocument.load(pack.bytes);
  const sizes = doc.getPages().map((p) => Math.round(p.getSize().width));
  expect(sizes).toEqual([595, 2384, 595, 595]);

  const texts = await pageTexts(pack.bytes);
  expect(texts[0]).toContain("SITE INSTRUCTION MEMO");
  expect(texts[0]).toContain("A. Add N12 bar at grid 2/B");
  expect(texts[1]).toContain("S-101");
  expect(texts[1]).toContain("A. ADD N12 BAR AT GRID 2/B");
  expect(texts[2]).toContain("S-001");
  expect(texts[2]).toContain("NOTED FOR INFORMATION:");
  expect(texts[3]).toContain("Instruction A – Add N12 bar at grid 2/B");
  expect(texts[3]).toContain("Photo IA2");
  expect(texts[3]).toContain("Photo G1");
  expect(texts[3]).toMatch(/\b4$/);
});
