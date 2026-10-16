import "fake-indexeddb/auto";
import { Dexie } from "dexie";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { matchesSearch } from "../features/projects/projectSearch";
import { createInspection, emptyClient } from "./inspections";
import { createMemo } from "./memos";
import {
  assignInspection,
  createProject,
  deleteProject,
  loadJobInspection,
  mergeContacts,
  projectsWithJobNumber,
  rememberContacts,
  saveJob,
  startProjectFor,
} from "./projects";
import { InspectionDb } from "./schema";
import { ensureSeeded } from "./seed";

let db: InspectionDb;

beforeEach(async () => {
  db = new InspectionDb(`test-${crypto.randomUUID()}`);
  await ensureSeeded(db);
});

afterEach(async () => {
  await db.delete();
});

const client = (name: string, company: string) => ({
  ...emptyClient(),
  name,
  company,
});

describe("projects", () => {
  test("an inspection reads its job details from its project", async () => {
    const project = await createProject(db, {
      jobNumber: " SY000001 ",
      jobName: "Example Apartments",
      client: client("Alex Example", "Example Builders"),
    });
    expect(project.jobNumber).toBe("SY000001");
    const a = await createInspection(db, new Date(2026, 9, 1), project.id);
    const b = await createInspection(db, new Date(2026, 9, 2), project.id);

    // Editing the project from one inspection changes it for both.
    await saveJob(db, a.id, {
      project: { jobName: "Example Towers", client: { address1: "1 Lane" } },
      inspection: { itemInspected: "Level 3 slab" },
    });
    const jobB = await loadJobInspection(db, b.id);
    expect(jobB?.jobName).toBe("Example Towers");
    expect(jobB?.client).toEqual({
      ...client("Alex Example", "Example Builders"),
      address1: "1 Lane",
    });
    expect(jobB?.itemInspected).toBe("");
    expect((await loadJobInspection(db, a.id))?.itemInspected).toBe(
      "Level 3 slab",
    );
  });

  test("finds projects with the same job number, ignoring case and spaces", async () => {
    await createProject(db, { jobNumber: "SY000001", jobName: "A" });
    expect(await projectsWithJobNumber(db, " sy000001")).toHaveLength(1);
    expect(await projectsWithJobNumber(db, "SY000002")).toHaveLength(0);
    expect(await projectsWithJobNumber(db, "  ")).toHaveLength(0);
  });

  test("an inspection can move to another project, keeping its memo", async () => {
    const first = await createProject(db, {
      jobNumber: "SY000001",
      jobName: "A",
    });
    const second = await createProject(db, {
      jobNumber: "SY000002",
      jobName: "B",
    });
    const inspection = await createInspection(db, new Date(), first.id);
    const memo = await createMemo(db, inspection.id);
    await assignInspection(db, inspection.id, second.id);
    expect((await loadJobInspection(db, inspection.id))?.jobNumber).toBe(
      "SY000002",
    );
    expect((await db.memos.get(memo.id))?.reference).toBe("SIM001");
  });

  test("a new project for an unsorted inspection starts from its old details", async () => {
    const inspection = await createInspection(db);
    await db.inspections.update(inspection.id, {
      unsorted: {
        jobName: "Old name",
        client: client("Alex Example", "Example Builders"),
      },
    });
    const project = await startProjectFor(db, inspection.id, {
      jobNumber: "SY000009",
      jobName: "New name",
    });
    expect(project.client.company).toBe("Example Builders");
    const saved = await db.inspections.get(inspection.id);
    expect(saved?.projectId).toBe(project.id);
    expect(saved?.unsorted).toBeUndefined();
  });

  test("deleting a project deletes its inspections, keeping the memo counter", async () => {
    const project = await createProject(db, {
      jobNumber: "SY000001",
      jobName: "A",
    });
    const other = await createProject(db, {
      jobNumber: "SY000002",
      jobName: "B",
    });
    const doomed = await createInspection(db, new Date(), project.id);
    const kept = await createInspection(db, new Date(), other.id);
    await createMemo(db, doomed.id);
    await deleteProject(db, project.id);
    expect(await db.projects.get(project.id)).toBeUndefined();
    expect(await db.inspections.get(doomed.id)).toBeUndefined();
    expect(await db.memos.count()).toBe(0);
    expect(await db.inspections.get(kept.id)).toBeDefined();
    expect((await db.memoCounters.get("SY000001"))?.lastSeq).toBe(1);
  });
});

describe("contacts", () => {
  test("merging skips blanks and duplicates, ignoring case and spaces", () => {
    const merged = mergeContacts(
      [{ id: "1", company: "Example Builders", attn: "Alex Example" }],
      [
        { company: " example builders ", attn: "ALEX EXAMPLE" },
        { company: "", attn: " " },
        { company: "Example Certifiers", attn: "" },
        { company: "Example Certifiers", attn: "" },
      ],
    );
    expect(merged.map((c) => [c.company, c.attn])).toEqual([
      ["Example Builders", "Alex Example"],
      ["Example Certifiers", ""],
    ]);
  });

  test("a new memo's client and typed recipients become contacts", async () => {
    const project = await createProject(db, {
      jobNumber: "SY000001",
      jobName: "A",
      client: client("Alex Example", "Example Builders"),
    });
    const inspection = await createInspection(db, new Date(), project.id);
    await createMemo(db, inspection.id);
    await rememberContacts(db, project.id, [
      { company: "Example Certifiers", attn: "Sam Sample" },
    ]);
    const contacts = (await db.projects.get(project.id))?.contacts ?? [];
    expect(contacts.map((c) => c.attn)).toEqual(["Alex Example", "Sam Sample"]);
  });
});

test("project search matches every word in number, name or client", () => {
  const project = {
    jobNumber: "SY000001",
    jobName: "Example Apartments",
    client: client("Alex Example", "Example Builders"),
  };
  expect(matchesSearch(project, "")).toBe(true);
  expect(matchesSearch(project, "sy0000 apart")).toBe(true);
  expect(matchesSearch(project, "builders")).toBe(true);
  expect(matchesSearch(project, "tower")).toBe(false);
});

test("v10 upgrade moves job details into projects by job number", async () => {
  const name = `test-${crypto.randomUUID()}`;
  const v9 = new Dexie(name);
  v9.version(9).stores({
    inspections: "id, jobNumber, updatedAt",
    memos: "id, inspectionId",
  });
  const old = (id: string, jobNumber: string, jobName: string, at: number) => ({
    id,
    jobNumber,
    jobName,
    itemInspected: "Slab",
    client: client("Alex Example", `${jobName} Builders`),
    date: "2026-10-01",
    inspector: "",
    status: "draft",
    photoIds: [],
    createdAt: at,
    updatedAt: at,
  });
  await v9
    .table("inspections")
    .bulkAdd([
      old("a", "SY000001", "Old", 1),
      old("b", " SY000001", "Newer", 2),
      old("c", "SY000002", "Other", 3),
      old("d", "", "Unnumbered", 4),
      old("e", "  ", "", 5),
    ]);
  await v9.table("memos").add({
    id: "memo",
    inspectionId: "a",
    recipients: [
      { company: "Old Builders", attn: "Alex Example", to: true, copy: false },
      { company: "Example Certifiers", attn: "", to: false, copy: true },
    ],
  });
  v9.close();

  db = new InspectionDb(name);
  const projects = await db.projects.orderBy("jobNumber").toArray();
  expect(projects.map((p) => [p.jobNumber, p.jobName])).toEqual([
    ["SY000001", "Newer"], // the most recently edited one's details
    ["SY000002", "Other"],
  ]);
  expect(projects[0].client.company).toBe("Newer Builders");
  expect(projects[0].contacts.map((c) => c.company)).toEqual([
    "Old Builders",
    "Example Certifiers",
  ]);

  const a = await db.inspections.get("a");
  const b = await db.inspections.get("b");
  expect(a?.projectId).toBe(projects[0].id);
  expect(b?.projectId).toBe(projects[0].id);
  expect(a).not.toHaveProperty("jobNumber");
  expect(a).not.toHaveProperty("client");
  expect(a?.itemInspected).toBe("Slab");

  // No job number: flagged, keeping its details to start a project from.
  const d = await db.inspections.get("d");
  expect(d?.projectId).toBeNull();
  expect(d?.unsorted?.jobName).toBe("Unnumbered");
  expect((await loadJobInspection(db, "d"))?.client.company).toBe(
    "Unnumbered Builders",
  );
  expect((await db.inspections.get("e"))?.projectId).toBeNull();
});
