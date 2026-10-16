import { describe, expect, test } from "vitest";
import starterSnippets from "../../content/snippets.json";
import { emptyClient } from "../../db/inspections";
import { blankMemo } from "../../db/memos";
import type { Item, JobInspection, Memo, Snippet } from "../../db/types";
import {
  DEFAULT_PHOTO_LINE,
  buildMemoPdfInput,
  defaultSalutation,
  defaultSiteVisitRequestedBy,
  letterRange,
  memoConditions,
  memoFields,
  photoLine,
  photoLineFor,
  referLine,
  DEFAULT_REFER_LINE,
} from "./buildMemo";

const conditionSnippets = (starterSnippets as Snippet[]).filter(
  (s) => s.kind === "condition",
);

const item = (letter: string, text: string, extra: Partial<Item> = {}): Item =>
  ({
    id: `item-${letter}-${extra.kind ?? "instruction"}`,
    letter,
    kind: "instruction",
    text,
    requiresPhotoConfirmation: false,
    ...extra,
  }) as Item;

const inspection: JobInspection = {
  id: "insp",
  projectId: "project",
  jobNumber: "SY000001",
  jobName: "Example Apartments",
  itemInspected: "Level 3 slab reinforcement",
  client: {
    ...emptyClient(),
    name: "Alex Example",
    company: "Example Builders Pty Ltd",
  },
  date: "2026-10-01",
  inspector: "Test Engineer",
  status: "draft",
  photoIds: [],
  createdAt: 0,
  updatedAt: 0,
};

function memo(extra: Partial<Memo> = {}): Memo {
  return {
    ...blankMemo(
      inspection,
      "SIM-001",
      {
        inspectorName: "Test Engineer",
        inspectorTitle: "Structural Engineer",
        defaultSentVia: "Email",
      },
      { id: "body", text: "At the time of the inspection…" },
      0,
    ),
    ...extra,
  };
}

describe("conditions", () => {
  test("standard conditions first, then instructions in letter order", () => {
    const items = [
      item("B", "Prop spacing per shop drawing"),
      item("A", "Add N12 bar at grid C/4", { requiresPhotoConfirmation: true }),
      item("A", "Crack noted", { kind: "observation" }),
    ];
    expect(
      memoConditions(memo(), items, conditionSnippets).map((c) => c.text),
    ).toEqual([
      "Complete items A–B listed below.",
      "A. Add N12 bar at grid C/4 *",
      "B. Prop spacing per shop drawing",
    ]);
  });

  test("photo confirmation: a * on the instruction, a line for the lead-in", () => {
    const a = item("A", "Add bar", { requiresPhotoConfirmation: true });
    const b = item("B", "Prop spacing");
    expect(
      memoConditions(
        memo({ itemOverrides: { [a.id]: "Add N16 bar" } }),
        [a, b],
        conditionSnippets,
      ).map((c) => c.text),
    ).toEqual([
      "Complete items A–B listed below.",
      // Reworded for the memo, it still carries the *.
      "A. Add N16 bar *",
      "B. Prop spacing",
    ]);
    expect(photoLineFor([a, b])).toBe(
      "Items marked * to be closed out with photos",
    );
    expect(photoLineFor([a, b], "Photos for items marked *.")).toBe(
      "Photos for items marked *.",
    );
    // An empty line (Settings) or no instruction needing photos: none.
    expect(photoLineFor([a, b], "")).toBe("");
    expect(photoLineFor([b])).toBe("");
    // Observations don't count.
    expect(
      photoLineFor([
        item("A", "Crack", {
          kind: "observation",
          requiresPhotoConfirmation: true,
        }),
      ]),
    ).toBe("");
  });

  test("Refer to drawings: one line replaces the instructions", () => {
    const a = item("A", "Add bar", { requiresPhotoConfirmation: true });
    const b = item("B", "Prop spacing");
    const c = item("C", "Lap length");
    const texts = (refer?: string) =>
      memoConditions(
        memo({ referToDrawings: true }),
        [a, b, c],
        conditionSnippets,
        refer,
      ).map((x) => x.text);
    expect(texts()).toEqual([
      "Complete items A–C listed below.",
      "Complete the instructions marked on the attached drawings (items A–C).",
    ]);
    expect(texts("See drawings for [letters].")[1]).toBe(
      "See drawings for A–C.",
    );
    expect(referLine([])).toBe(DEFAULT_REFER_LINE);
    expect(referLine([{ kind: "referDrawings", text: " " }])).toBe(
      DEFAULT_REFER_LINE,
    );
    // No instructions: nothing to refer to.
    expect(
      memoConditions(memo({ referToDrawings: true }), [], conditionSnippets),
    ).toEqual([]);
  });

  test("the photo line comes from Settings, else the default", () => {
    expect(photoLine([])).toBe(DEFAULT_PHOTO_LINE);
    expect(
      photoLine([
        { kind: "condition", text: "x" },
        { kind: "photoNote", text: " Photos for items marked *. " },
      ]),
    ).toBe("Photos for items marked *.");
  });

  test("the engineer's ticks win over the defaults", () => {
    const texts = memoConditions(
      memo({
        conditionChoices: {
          "condition-complete-listed-items": false,
          "condition-photo-confirmation": true,
        },
      }),
      [item("A", "Add bar")],
      conditionSnippets,
    ).map((c) => c.text);
    expect(texts).toEqual([
      "Confirm completion of items via photos prior to proceeding.",
      "A. Add bar",
    ]);
  });

  test("an instruction can be reworded for the memo only", () => {
    const a = item("A", "Add bar");
    const [line] = memoConditions(
      memo({
        conditionChoices: { "condition-complete-listed-items": false },
        itemOverrides: { [a.id]: "Add N16 bar instead" },
      }),
      [a],
      conditionSnippets,
    );
    expect(line).toMatchObject({
      text: "A. Add N16 bar instead",
      reworded: true,
    });
  });

  test("no instructions: no conditions, so the memo says Ok to proceed.", () => {
    expect(
      memoConditions(
        memo(),
        [item("A", "x", { kind: "observation" })],
        conditionSnippets,
      ),
    ).toEqual([]);
  });
});

describe("letter ranges", () => {
  test("first to last", () => {
    expect(letterRange(["C", "A", "B"])).toBe("A–C");
    expect(letterRange(["A"])).toBe("A");
    expect(letterRange([])).toBe("");
    expect(letterRange(["Z", "AA", "AB"])).toBe("Z–AB");
  });
});

describe("defaults", () => {
  test("salutation from the first To recipient's first name", () => {
    expect(
      defaultSalutation([
        { company: "Cert Co", attn: "Sam Sample", to: false, copy: true },
        { company: "Builder", attn: "Alex Example", to: true, copy: false },
      ]),
    ).toBe("Dear Alex,");
    expect(defaultSalutation([])).toBe("");
  });

  test("site visit requested by the client", () => {
    expect(defaultSiteVisitRequestedBy(inspection.client)).toBe(
      "Alex Example, Example Builders Pty Ltd",
    );
  });

  test("job details come from the inspection; reason for visit follows item inspected", () => {
    const fields = memoFields(memo(), inspection);
    expect(fields).toMatchObject({
      jobNumber: "SY000001",
      reasonForVisit: "Level 3 slab reinforcement",
      salutation: "Dear Alex,",
      siteVisitRequestedBy: "Alex Example, Example Builders Pty Ltd",
    });
    expect(
      memoFields(memo({ reasonForVisit: "Re-check" }), inspection)
        .reasonForVisit,
    ).toBe("Re-check");
  });

  test("the PDF gets the confirmation paragraph, then the body message", () => {
    const input = buildMemoPdfInput(memo(), inspection, [], conditionSnippets);
    expect(input.bodyParagraphs).toEqual([
      "We confirm having inspected the Level 3 slab reinforcement as highlighted on the drawing attached.",
      "At the time of the inspection…",
    ]);
    expect(input.conditions).toEqual([]);
  });
});
