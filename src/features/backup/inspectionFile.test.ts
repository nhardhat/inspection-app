import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  collectInspection,
  importInspection,
  needsBackup,
  type InspectionData,
} from "../../db/backup";
import { addDrawing } from "../../db/drawings";
import { createInspection, emptyClient } from "../../db/inspections";
import { addCopy, createItem, updateItem } from "../../db/items";
import { addMarkup } from "../../db/markups";
import { createMemo, markMemoExported, updateMemo } from "../../db/memos";
import { addPhotos } from "../../db/photos";
import { createProject } from "../../db/projects";
import { InspectionDb } from "../../db/schema";
import { ensureSeeded } from "../../db/seed";
import { setMemoSignature } from "../../db/signatures";
import {
  InspectionFileError,
  inspectionFilename,
  packInspection,
  unpackInspection,
} from "./inspectionFile";

const dbs: InspectionDb[] = [];
function newDb() {
  const db = new InspectionDb(`test-${crypto.randomUUID()}`);
  dbs.push(db);
  return db;
}

afterEach(async () => {
  await Promise.all(dbs.splice(0).map((db) => db.delete()));
});

const bytes = (...values: number[]) => Uint8Array.from(values);
const photo = (original: boolean) => ({
  data: bytes(0xff, 0xd8, 1, 2, 3).buffer,
  type: "image/jpeg",
  width: 1600,
  height: 1200,
  takenAt: 1,
  source: (original ? "camera" : "library") as "camera" | "library",
  original: original
    ? { data: bytes(0xff, 0xd8, 9, 9, 9, 9).buffer, type: "image/jpeg" }
    : undefined,
});
// A 1 x 1 PNG for the signature.
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

let source: InspectionDb;
let inspectionId: string;

/** A full inspection: project, drawing, pins with a copy and arrows, markup, photos, memo. */
beforeEach(async () => {
  source = newDb();
  await ensureSeeded(source);
  const project = await createProject(source, {
    jobNumber: "SY000001",
    jobName: "Example Apartments",
    client: {
      ...emptyClient(),
      name: "Alex Example",
      company: "Example Builders",
    },
  });
  const inspection = await createInspection(
    source,
    new Date(2026, 9, 1),
    project.id,
  );
  inspectionId = inspection.id;
  await source.inspections.update(inspectionId, {
    itemInspected: "Level 3 slab reinforcement",
  });
  const drawing = await addDrawing(source, inspectionId, {
    name: "S-101",
    pdf: new TextEncoder().encode("%PDF-1.7 synthetic"),
    pageCount: 2,
    pageSizes: [
      [2384, 1684],
      [1191, 842],
    ],
  });
  const box = { x: 0.6, y: 0.05 };
  const a = await createItem(
    source,
    {
      inspectionId,
      drawingId: drawing.id,
      page: 1,
      x: 0.3,
      y: 0.4,
      arrows: [{ id: "arrow-1", x: 0.5, y: 0.5 }],
    },
    box,
  );
  await updateItem(source, a.id, {
    text: "Add N12 bar",
    requiresPhotoConfirmation: true,
  });
  await addCopy(
    source,
    a.id,
    { drawingId: drawing.id, page: 2, x: 0.2, y: 0.2 },
    box,
  );
  await createItem(
    source,
    {
      inspectionId,
      drawingId: drawing.id,
      page: 2,
      x: 0.7,
      y: 0.7,
      kind: "observation",
    },
    box,
  );
  await addMarkup(source, {
    inspectionId,
    drawingId: drawing.id,
    page: 1,
    tool: "pen",
    points: [0.1, 0.1, 0.15, 0.12, 0.2, 0.18],
    colour: "#DA1A32",
    weight: 0.0025,
  });
  await addMarkup(source, {
    inspectionId,
    drawingId: drawing.id,
    page: 2,
    tool: "highlighter",
    points: [0.3, 0.3, 0.5, 0.3],
    colour: "#FFD400",
    weight: 0.012,
  });
  await addPhotos(source, { itemId: a.id }, [photo(true), photo(false)]);
  await addPhotos(source, { inspectionId }, [photo(false)]);
  const memo = await createMemo(source, inspectionId);
  await updateMemo(source, memo.id, {
    itemOverrides: { [a.id]: "Reworded" },
    referToDrawings: true,
  });
  await setMemoSignature(source, memo.id, PNG);
  await markMemoExported(source, memo.id, { [a.id]: "instruction:A" });
});

async function exportFile(includeOriginals = true) {
  const collected = await collectInspection(source, inspectionId, {
    includeOriginals,
    app: "test",
    now: 1000,
  });
  return unpackInspection(packInspection(collected));
}

/** The file's data without what an export stamps on it. */
function comparable(data: InspectionData) {
  return {
    ...data,
    app: undefined,
    exportedAt: undefined,
    inspection: { ...data.inspection, backedUpAt: undefined },
  };
}

describe("inspection file", () => {
  test("round-trips losslessly: export, import elsewhere, export again", async () => {
    const file = await exportFile();
    expect(file.data.photos.some((p) => p.originalBlobId)).toBe(true);

    const target = newDb();
    await ensureSeeded(target);
    expect(file.data.schemaVersion).toBe(2);
    expect(file.data.markups).toHaveLength(2);
    const id = await importInspection(target, file.data, file.blobs, "new");
    expect(id).toBe(inspectionId);

    const again = await collectInspection(target, id, {
      includeOriginals: true,
      app: "test",
      now: 1000,
    });
    expect(comparable(again.data)).toEqual(comparable(file.data));
    for (const blob of again.blobs)
      expect(new Uint8Array(blob.data)).toEqual(file.blobs.get(blob.id));
    // The memo counter moved up, so the next memo for the job is SIM-002.
    expect((await target.memoCounters.get("SY000001"))?.lastSeq).toBe(1);
  });

  test("without originals, photos keep only their working copies", async () => {
    const file = await exportFile(false);
    expect(file.data.photos.every((p) => !p.originalBlobId)).toBe(true);
    expect([...file.blobs.keys()]).toHaveLength(
      1 + 3 + 1, // drawing, three working copies, signature
    );
  });

  test("keep both: a second copy with new ids, wired together", async () => {
    // A page naming the drawing whose PDF it shows (as a page moved in from
    // another drawing does) follows the new id.
    const original = (await source.drawings
      .where("inspectionId")
      .equals(inspectionId)
      .first())!;
    await source.drawings.update(original.id, {
      pages: original.pages.map((p, i) =>
        i === 0 ? { ...p, from: original.id } : p,
      ),
    });
    const file = await exportFile();
    const id = await importInspection(
      source,
      file.data,
      file.blobs,
      "keepBoth",
    );
    expect(id).not.toBe(inspectionId);
    expect(await source.inspections.count()).toBe(2);
    const items = await source.items.where("inspectionId").equals(id).toArray();
    const drawings = await source.drawings
      .where("inspectionId")
      .equals(id)
      .toArray();
    expect(items).toHaveLength(2);
    expect(drawings).toHaveLength(1);
    expect(drawings[0].pages[0].from).toBe(drawings[0].id);
    for (const item of items) {
      expect(item.drawingId).toBe(drawings[0].id);
      for (const copy of item.copies ?? [])
        expect(copy.drawingId).toBe(drawings[0].id);
      expect(await source.photos.bulkGet(item.photoIds)).not.toContain(
        undefined,
      );
    }
    const marks = await source.markups
      .where("inspectionId")
      .equals(id)
      .toArray();
    expect(marks).toHaveLength(2);
    for (const mark of marks) expect(mark.drawingId).toBe(drawings[0].id);
    const memo = await source.memos.where("inspectionId").equals(id).first();
    const a = items.find((i) => i.kind === "instruction")!;
    expect(memo!.itemOverrides).toEqual({ [a.id]: "Reworded" });
    expect(await source.blobs.get(memo!.signatureBlobId!)).toBeDefined();
    // Same project: joined, not duplicated.
    expect(await source.projects.count()).toBe(1);
  });

  test("replace: the file's copy takes over the one on the device", async () => {
    const file = await exportFile();
    await source.items.clear();
    await importInspection(source, file.data, file.blobs, "replace");
    expect(await source.inspections.count()).toBe(1);
    expect(
      await source.items.where("inspectionId").equals(inspectionId).count(),
    ).toBe(2);
  });

  test("a project with the same job number is joined; imported counts as backed up", async () => {
    const file = await exportFile();
    const target = newDb();
    await ensureSeeded(target);
    const local = await createProject(target, {
      jobNumber: " sy000001 ",
      jobName: "Local name",
    });
    const id = await importInspection(target, file.data, file.blobs, "new");
    const imported = await target.inspections.get(id);
    expect(imported!.projectId).toBe(local.id);
    expect((await target.projects.get(local.id))!.jobName).toBe("Local name");
    expect(needsBackup(imported!)).toBe(false);
  });

  test("a version 1 file (before markup) still imports", async () => {
    const file = await exportFile();
    const v1: InspectionData = { ...file.data, schemaVersion: 1 };
    delete v1.markups;
    const target = newDb();
    await ensureSeeded(target);
    const id = await importInspection(target, v1, file.blobs, "new");
    expect(await target.items.where("inspectionId").equals(id).count()).toBe(2);
    expect(await target.markups.count()).toBe(0);
  });

  test("replace removes the device's markup before the file's goes in", async () => {
    const file = await exportFile();
    await importInspection(source, file.data, file.blobs, "replace");
    expect(await source.markups.count()).toBe(2);
  });

  test("rejects other files and files from a newer version", async () => {
    expect(() => unpackInspection(bytes(1, 2, 3))).toThrow(InspectionFileError);
    const collected = await collectInspection(source, inspectionId, {
      includeOriginals: false,
      app: "test",
    });
    collected.data.schemaVersion = 99;
    expect(() => unpackInspection(packInspection(collected))).toThrow(
      /newer version/,
    );
  });

  test("file name", () => {
    expect(
      inspectionFilename(
        "SY000001",
        "Level 3 slab / reinforcement",
        "2026-10-05",
      ),
    ).toBe("SY000001_Level-3-slab-reinforcement_2026-10-05.inspection");
  });
});
