import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { InspectionDb } from "./schema";
import { ensureSeeded } from "./seed";
import { SETTINGS_ID } from "./types";

let db: InspectionDb;

beforeEach(() => {
  db = new InspectionDb(`test-${crypto.randomUUID()}`);
});

afterEach(async () => {
  await db.delete();
});

describe("ensureSeeded", () => {
  test("seeds the 9 starter snippets and settings on first run", async () => {
    await ensureSeeded(db);

    expect(await db.snippets.count()).toBe(10);
    expect(await db.snippets.where("kind").equals("body").count()).toBe(4);
    expect(await db.snippets.where("kind").equals("condition").count()).toBe(2);
    expect(await db.snippets.where("kind").equals("heading").count()).toBe(2);
    expect(await db.snippets.where("kind").equals("photoNote").count()).toBe(1);
    expect(
      await db.snippets.where("kind").equals("referDrawings").count(),
    ).toBe(1);
    expect((await db.settings.get(SETTINGS_ID))?.snippetsSeeded).toBe(true);
  });

  test("a device seeded before the photo note gets it once", async () => {
    await ensureSeeded(db);
    await db.snippets.where("kind").equals("photoNote").delete();
    await ensureSeeded(db);
    await ensureSeeded(db);
    const notes = await db.snippets.where("kind").equals("photoNote").toArray();
    expect(notes.map((n) => n.text)).toEqual([
      "Items marked * to be closed out with photos",
    ]);
  });

  test("earlier photo texts become the * line once; the engineer's own text stays", async () => {
    await ensureSeeded(db);
    const id = (await db.snippets.where("kind").equals("photoNote").first())!
      .id;
    await db.snippets.update(id, {
      text: "(provide photos confirming completion before proceeding)",
      label: "Photo confirmation note",
    });
    await ensureSeeded(db);
    expect((await db.snippets.get(id))?.text).toBe(
      "Items marked * to be closed out with photos",
    );
    expect((await db.snippets.get(id))?.label).toBe("Photo confirmation line");
    await db.snippets.update(id, { text: "Photos for items marked *." });
    await ensureSeeded(db);
    expect((await db.snippets.get(id))?.text).toBe(
      "Photos for items marked *.",
    );
  });

  test("running again does not duplicate snippets", async () => {
    await ensureSeeded(db);
    await ensureSeeded(db);

    expect(await db.snippets.count()).toBe(10);
  });

  test("never overwrites an edited snippet or restores a deleted one", async () => {
    await ensureSeeded(db);
    const [first, second] = await db.snippets.toArray();
    await db.snippets.update(first.id, { text: "Edited by the engineer" });
    await db.snippets.delete(second.id);

    await ensureSeeded(db);

    expect((await db.snippets.get(first.id))?.text).toBe(
      "Edited by the engineer",
    );
    expect(await db.snippets.get(second.id)).toBeUndefined();
    expect(await db.snippets.count()).toBe(9);
  });

  test("keeps existing settings values", async () => {
    await db.settings.put({
      id: SETTINGS_ID,
      inspectorName: "Test Engineer",
      inspectorTitle: "Senior Structural Engineer",
      defaultSentVia: "Aconex",
      snippetsSeeded: false,
    });

    await ensureSeeded(db);

    const settings = await db.settings.get(SETTINGS_ID);
    expect(settings?.inspectorName).toBe("Test Engineer");
    expect(settings?.snippetsSeeded).toBe(true);
  });
});
