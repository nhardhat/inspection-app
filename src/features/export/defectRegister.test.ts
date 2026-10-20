import "fake-indexeddb/auto";
import ExcelJS from "exceljs";
import { afterEach, beforeEach, expect, test } from "vitest";
import { addDrawing } from "../../db/drawings";
import { createInspection, emptyClient } from "../../db/inspections";
import { createGeneralNote, createItem, updateItem } from "../../db/items";
import { createMemo } from "../../db/memos";
import { addPhotos } from "../../db/photos";
import { createProject } from "../../db/projects";
import { InspectionDb } from "../../db/schema";
import { ensureSeeded } from "../../db/seed";
import {
  buildRegisterXlsx,
  registerFilename,
  registerHeader,
  registerRows,
} from "./defectRegister";
import { loadPackData } from "./packData";

let db: InspectionDb;

beforeEach(async () => {
  db = new InspectionDb(`test-${crypto.randomUUID()}`);
  await ensureSeeded(db);
});
afterEach(async () => {
  await db.delete();
});

const photo = () => ({
  data: new Uint8Array([1, 2, 3]).buffer,
  type: "image/jpeg",
  width: 1600,
  height: 1200,
  takenAt: 0,
  source: "library" as const,
});

async function setUp() {
  const project = await createProject(db, {
    jobNumber: "SY000001",
    jobName: "Example Apartments",
    client: emptyClient(),
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
    pageCount: 2,
    pageSizes: [
      [2384, 1684],
      [2384, 1684],
    ],
  });
  const box = { x: 0.6, y: 0.05 };
  const spot = (page: number, kind?: "observation") => ({
    inspectionId: inspection.id,
    drawingId: drawing.id,
    page,
    x: 0.3,
    y: 0.4,
    kind,
  });
  const a = await createItem(db, spot(2), box);
  await updateItem(db, a.id, {
    text: "Add N12 bar",
    requiresPhotoConfirmation: true,
  });
  await addPhotos(db, { itemId: a.id }, [photo(), photo()]);
  const o = await createItem(db, spot(1, "observation"), box);
  await updateItem(db, o.id, { text: "Crack noted" });
  await createGeneralNote(db, inspection.id, Date.now(), {
    text: "Cover checked throughout",
  });
  await createMemo(db, inspection.id);
  return (await loadPackData(db, inspection.id))!;
}

test("one row per item: instructions, then observations with general notes", async () => {
  const data = await setUp();
  expect(registerHeader(data)).toEqual({
    jobNumber: "SY000001",
    jobName: "Example Apartments",
    reference: "SIM001",
    itemInspected: "Level 3 slab",
    date: "20/10/2026",
  });
  expect(
    registerRows(data).map((r) => [
      r.ref,
      r.type,
      r.description,
      r.drawing,
      r.sheet,
      r.photoConfirmation,
      r.photoRefs,
    ]),
  ).toEqual([
    ["IA", "Instruction", "Add N12 bar", "S-101", "2", "Yes", "IA1, IA2"],
    ["OA", "General note", "Cover checked throughout", "All", "All", "", ""],
    ["OB", "Observation", "Crack noted", "S-101", "1", "", ""],
  ]);
  expect(registerFilename(data)).toBe(
    "SY000001-SIM001-A-Level 3 slab - Defect register.xlsx",
  );
});

test("the workbook: header block, then the table with the builder's columns", async () => {
  const data = await setUp();
  const book = new ExcelJS.Workbook();
  await book.xlsx.load((await buildRegisterXlsx(data)).buffer as ArrayBuffer);
  const sheet = book.getWorksheet("Defect register")!;
  expect(sheet.getCell("A1").value).toBe("Job number");
  expect(sheet.getCell("C1").value).toBe("SY000001");
  expect(sheet.getCell("C3").value).toBe("SIM001");
  const head = sheet.getRow(7).values as unknown[];
  expect(head.slice(1)).toEqual([
    "Ref",
    "Type",
    "Description",
    "Drawing",
    "Sheet/page",
    "Photo confirmation required",
    "Photo refs",
    "Date raised",
    "Inspector",
    "Status",
    "Date closed",
    "Comments",
  ]);
  expect(sheet.getCell("A8").value).toBe("IA");
  expect(sheet.getCell("I8").value).toBe("Test Engineer");
  expect(sheet.rowCount).toBe(10);
});
