import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createInspection } from "./inspections";
import {
  addInspectionType,
  removeInspectionType,
  typeNotes,
} from "./inspectionTypes";
import { updateItem } from "./items";
import { InspectionDb } from "./schema";
import { ensureSeeded } from "./seed";
import { SETTINGS_ID, type Inspection, type Snippet } from "./types";

let db: InspectionDb;
let inspection: Inspection;
const concrete: Snippet = {
  id: "type-concrete",
  kind: "inspectionType",
  label: "General concrete",
  text: ["Cover to be checked", "", "  Bar chairs at 1 m max  "].join("\n"),
};

beforeEach(async () => {
  db = new InspectionDb(`test-${crypto.randomUUID()}`);
  inspection = await createInspection(db, new Date(2026, 9, 20));
});
afterEach(async () => {
  await db.delete();
});

/** The inspection's items in letter order (the database's order is by id). */
const notes = async () =>
  (await db.items.where("inspectionId").equals(inspection.id).toArray()).sort(
    (a, b) => a.letter.localeCompare(b.letter),
  );

describe("inspection types", () => {
  test("each line of a type is a general note", () => {
    expect(typeNotes(concrete)).toEqual([
      "Cover to be checked",
      "Bar chairs at 1 m max",
    ]);
  });

  test("picking adds its notes; removing takes them, asking if edited", async () => {
    const type = concrete;
    await addInspectionType(db, inspection.id, type);
    await addInspectionType(db, inspection.id, type); // once only
    let all = await notes();
    expect(all.map((n) => [n.letter, n.text, n.general])).toEqual([
      ["A", "Cover to be checked", true],
      ["B", "Bar chairs at 1 m max", true],
    ]);
    expect((await db.inspections.get(inspection.id))!.types).toEqual([type.id]);

    // Edited: it asks first.
    await updateItem(db, all[0].id, { text: "Cover 40 mm checked" });
    expect(await removeInspectionType(db, inspection.id, type.id)).toEqual({
      edited: 1,
      removed: false,
    });
    expect(await notes()).toHaveLength(2);
    expect(
      await removeInspectionType(db, inspection.id, type.id, true),
    ).toEqual({ edited: 1, removed: true });
    all = await notes();
    expect(all).toHaveLength(0);
    expect((await db.inspections.get(inspection.id))!.types).toEqual([]);
  });

  test("the starter types are seeded, once, on devices seeded before", async () => {
    await ensureSeeded(db);
    const types = () =>
      db.snippets.where("kind").equals("inspectionType").toArray();
    expect((await types()).map((t) => t.label)).toEqual([
      "General concrete",
      "General piling",
      "General steel",
    ]);
    // Deleted by the engineer: not brought back.
    await db.snippets.where("kind").equals("inspectionType").delete();
    await ensureSeeded(db);
    expect(await types()).toHaveLength(0);
  });

  test("an iPad set up before types gets them once", async () => {
    await ensureSeeded(db);
    // As before this version: no types, no record of seeding them.
    await db.snippets.where("kind").equals("inspectionType").delete();
    await db.settings.update(SETTINGS_ID, { seededKinds: undefined });
    await ensureSeeded(db);
    await ensureSeeded(db);
    expect(
      await db.snippets.where("kind").equals("inspectionType").count(),
    ).toBe(3);
  });
});
