import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createInspection, deleteInspection, emptyClient } from "./inspections";
import { createMemo, getMemo, memoReference, updateMemo } from "./memos";
import { createProject } from "./projects";
import { InspectionDb } from "./schema";
import { ensureSeeded } from "./seed";
import { SETTINGS_ID } from "./types";

let db: InspectionDb;

beforeEach(async () => {
  db = new InspectionDb(`test-${crypto.randomUUID()}`);
  await ensureSeeded(db);
  await db.settings.update(SETTINGS_ID, {
    inspectorName: "Test Engineer",
    inspectorTitle: "Structural Engineer",
    defaultSentVia: "Aconex",
  });
});

afterEach(async () => {
  await db.delete();
});

async function inspectionFor(
  jobNumber: string,
  jobName = "Example Apartments",
) {
  const project = await createProject(db, {
    jobNumber,
    jobName,
    client: {
      ...emptyClient(),
      name: "Alex Example",
      company: "Example Builders Pty Ltd",
    },
  });
  return createInspection(db, new Date(2026, 9, 1), project.id);
}

describe("memos", () => {
  test("references count per job number: SIM001, SIM002...", async () => {
    const a = await createMemo(db, (await inspectionFor("SY000001")).id);
    const b = await createMemo(db, (await inspectionFor("SY000001")).id);
    const c = await createMemo(db, (await inspectionFor("SY000002")).id);
    expect([a.reference, b.reference, c.reference]).toEqual([
      "SIM001",
      "SIM002",
      "SIM001",
    ]);
    expect(memoReference(12)).toBe("SIM012");
    expect(memoReference(3, "ssi")).toBe("SSI003");
    expect(memoReference(3, " 1-2 ")).toBe("SIM003");
  });

  test("a project's own letters start its references", async () => {
    const inspection = await inspectionFor("SY000003");
    await db.projects.update(inspection.projectId!, { referencePrefix: "SSI" });
    expect((await createMemo(db, inspection.id)).reference).toBe("SSI001");
  });

  test("an inspection has one memo; creating again returns it", async () => {
    const inspection = await inspectionFor("SY000001");
    const first = await createMemo(db, inspection.id);
    const again = await createMemo(db, inspection.id);
    expect(again.id).toBe(first.id);
    expect(await db.memos.count()).toBe(1);
  });

  test("needs a job number and job name", async () => {
    const noName = await inspectionFor("SY000001", "");
    await expect(createMemo(db, noName.id)).rejects.toThrow();
    expect(await db.memoCounters.count()).toBe(0);
  });

  test("starts from the client, Settings and the default body message", async () => {
    const memo = await createMemo(db, (await inspectionFor("SY000001")).id);
    expect(memo).toMatchObject({
      recipients: [
        {
          company: "Example Builders Pty Ltd",
          attn: "Alex Example",
          to: true,
          copy: false,
        },
      ],
      sentVia: "Aconex",
      signOffName: "Test Engineer",
      signOffTitle: "Structural Engineer",
      bodySnippetId: "body-works-generally-in-accordance",
      salutation: null,
    });
    expect(memo.bodyText).toMatch(/^At the time of the inspection/);
  });

  test("saves edits", async () => {
    const inspection = await inspectionFor("SY000001");
    const memo = await createMemo(db, inspection.id);
    await updateMemo(db, memo.id, { reference: "SIM-007", salutation: "Hi," });
    expect(await getMemo(db, inspection.id)).toMatchObject({
      reference: "SIM-007",
      salutation: "Hi,",
    });
  });

  test("deleting the inspection keeps the counter, so references aren't reused", async () => {
    const inspection = await inspectionFor("SY000001");
    await createMemo(db, inspection.id);
    await deleteInspection(db, inspection.id);
    expect(await db.memos.count()).toBe(0);
    const next = await createMemo(db, (await inspectionFor("SY000001")).id);
    expect(next.reference).toBe("SIM002");
  });
});
