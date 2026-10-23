import "fake-indexeddb/auto";
import { writeFileSync } from "node:fs";
import { PDFDict, PDFHexString, PDFDocument, PDFName, PDFRef } from "pdf-lib";
import { afterEach, beforeEach, expect, test } from "vitest";
import { addDrawing } from "../../../db/drawings";
import { createInspection, emptyClient } from "../../../db/inspections";
import { createItem, updateItem } from "../../../db/items";
import { addMarkup, type NewMarkup } from "../../../db/markups";
import { createMemo } from "../../../db/memos";
import { createProject } from "../../../db/projects";
import { InspectionDb } from "../../../db/schema";
import { ensureSeeded } from "../../../db/seed";
import {
  SHEET_SIZES,
  TYPICAL_DRAWING,
  buildSyntheticDrawing,
} from "../../drawings/fixtures/syntheticDrawing";
import { loadTestMemoAssets } from "../../memo/pdf/memoAssets.testutil";
import { buildPack } from "../buildPack";
import { blobLoader, loadPackData } from "../packData";

let db: InspectionDb;
beforeEach(async () => {
  db = new InspectionDb(`test-${crypto.randomUUID()}`);
  await ensureSeeded(db);
});
afterEach(async () => {
  await db.delete();
});

const RED = "#DA1A32";
const BLUE = "#1F5FBF";
const GREEN = "#2E8B57";

/** One of each markup type on the A1 sheet, plus pins with arrows. */
async function sampleInspection() {
  const project = await createProject(db, {
    jobNumber: "SY000001",
    jobName: "Example Apartments",
    client: {
      ...emptyClient(),
      name: "Alex Example",
      company: "Example Builders Pty Ltd",
    },
  });
  const inspection = await createInspection(
    db,
    new Date(2026, 9, 23),
    project.id,
  );
  await db.inspections.update(inspection.id, {
    itemInspected: "Level 3 slab reinforcement",
    inspector: "Test Engineer",
  });
  const drawing = await addDrawing(db, inspection.id, {
    name: "S-101",
    pdf: await buildSyntheticDrawing(TYPICAL_DRAWING),
    pageCount: 3,
    pageSizes: TYPICAL_DRAWING.map((s) => SHEET_SIZES[s.size]),
  });
  const on = { inspectionId: inspection.id, drawingId: drawing.id, page: 1 };
  const mark = (m: Omit<NewMarkup, keyof typeof on>) =>
    addMarkup(db, { ...on, ...m });
  const wave = Array.from({ length: 30 }, (_, i) => [
    0.08 + i * 0.004,
    0.15 + Math.sin(i / 3) * 0.015,
  ]).flat();
  await mark({ tool: "pen", points: wave, colour: RED, weight: 0.0025 });
  await mark({
    tool: "highlighter",
    points: [0.08, 0.24, 0.2, 0.24],
    colour: "#FFD400",
    weight: 0.012,
  });
  await mark({
    tool: "line",
    points: [0.25, 0.13, 0.35, 0.2],
    colour: BLUE,
    weight: 0.0025,
  });
  await mark({
    tool: "arrow",
    points: [0.25, 0.25, 0.35, 0.3],
    colour: RED,
    weight: 0.0025,
  });
  await mark({
    tool: "rect",
    points: [0.4, 0.12, 0.5, 0.22],
    colour: RED,
    weight: 0.0025,
    fill: true,
  });
  await mark({
    tool: "ellipse",
    points: [0.55, 0.12, 0.65, 0.22],
    colour: GREEN,
    weight: 0.0025,
    fill: true,
  });
  await mark({
    tool: "cloud",
    points: [0.4, 0.3, 0.5, 0.4],
    colour: RED,
    weight: 0.0025,
    fill: true,
  });
  await mark({
    tool: "rect",
    points: [0.55, 0.3, 0.65, 0.4],
    colour: BLUE,
    weight: 0.0025,
    rotation: 0.3,
  });
  await mark({
    tool: "polygon",
    points: [0.08, 0.4, 0.18, 0.35, 0.2, 0.48, 0.1, 0.5],
    colour: GREEN,
    weight: 0.0025,
    fill: true,
  });
  await mark({
    tool: "oval",
    points: [0.3, 0.45, 0.36, 0.42, 0.29, 0.41],
    colour: BLUE,
    weight: 0.0025,
  });
  await mark({
    tool: "rect",
    points: [0.08, 0.56, 0.2, 0.62],
    colour: "#FFD400",
    weight: 0.012,
    highlight: true,
  });
  await mark({
    tool: "text",
    points: [0.42, 0.5, 0.12, 0.03, 0.36, 0.58],
    colour: RED,
    weight: 0.012,
    text: "CHECK LAP LENGTH",
  });
  await mark({
    tool: "text",
    points: [0.42, 0.62, 0.1, 0.03],
    colour: BLUE,
    weight: 0.012,
    text: "NOTE ONLY",
  });

  const box = { x: 0.6, y: 0.05 };
  const pin = async (
    x: number,
    y: number,
    text: string,
    tip: { x: number; y: number },
    kind?: "observation",
  ) => {
    const item = await createItem(db, { ...on, x, y, kind }, box);
    await updateItem(db, item.id, {
      text,
      arrows: [{ id: crypto.randomUUID(), ...tip }],
    });
  };
  await pin(0.7, 0.5, "Add N12 bar at grid 2/B", { x: 0.78, y: 0.62 });
  await pin(0.25, 0.7, "Prop spacing per shop drawing", { x: 0.25, y: 0.8 });
  await pin(
    0.6,
    0.75,
    "Existing crack noted at grid 4",
    { x: 0.5, y: 0.85 },
    "observation",
  );
  const memo = await createMemo(db, inspection.id);
  await db.memos.update(memo.id, {
    recipients: [
      ...memo.recipients,
      {
        company: "Example Certifiers",
        attn: "Sam Sample",
        to: false,
        copy: true,
      },
    ],
  });
  return inspection;
}

test("editable PDF: memo fields as form fields, markup as annotations", async () => {
  const inspection = await sampleInspection();
  const data = (await loadPackData(db, inspection.id))!;
  const pack = await buildPack(
    data,
    await loadTestMemoAssets(),
    blobLoader(db),
    () => {},
    { editable: true },
  );
  // npx vitest run editable with BLUEBEAM_SPIKE_OUT=<file> saves the sample.
  const out = process.env.BLUEBEAM_SPIKE_OUT;
  if (out) writeFileSync(out, pack.bytes);
  expect(pack.filename).toBe(
    "SY000001-SIM001-A-Level 3 slab reinforcement - editable.pdf",
  );

  const doc = await PDFDocument.load(pack.bytes);
  const names = doc
    .getForm()
    .getFields()
    .map((f) => f.getName());
  for (const name of [
    "Client name",
    "Job name",
    "Reference",
    "Recipient 2 company",
    "Salutation",
    "Condition 1",
  ])
    expect(names).toContain(name);
  expect(doc.getForm().getTextField("Recipient 2 attn").getText()).toBe(
    "Sam Sample",
  );

  const annots = doc.getPages()[1].node.Annots()!;
  const subtypes = annots.asArray().map((ref) => {
    const a = doc.context.lookup(ref as PDFRef) as PDFDict;
    expect(a.get(PDFName.of("AP"))).toBeInstanceOf(PDFDict);
    const subj = a.get(PDFName.of("Subj")) as PDFHexString;
    return `${a.get(PDFName.of("Subtype"))} ${subj.decodeText()}`;
  });
  // Sorted: marks drawn at the same moment come out in id order.
  expect(subtypes.sort()).toEqual(
    [
      "/Ink Pen",
      "/Ink Highlight highlighter",
      "/Line Line",
      "/Line Arrow",
      "/Square Rectangle",
      "/Circle Ellipse",
      "/Polygon Cloud",
      "/Polygon Rectangle",
      "/Polygon Polygon",
      "/Polygon Oval",
      "/Square Highlight rectangle",
      "/FreeText Callout",
      "/FreeText Callout",
      "/FreeText Notes box",
      "/Circle Pin",
      "/PolyLine Pin arrow",
      "/Circle Pin",
      "/Line Pin arrow",
      "/Stamp Pin",
      "/PolyLine Pin arrow",
    ].sort(),
  );
});
