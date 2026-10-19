import { describe, expect, test } from "vitest";
import type { Item } from "../../db/types";
import {
  boxHeader,
  boxMetrics,
  boxWidthLimits,
  clampBoxPosition,
  defaultBoxPosition,
  boxLines,
  initialAndSurname,
  observationLines,
} from "./observationBox";

const A1 = { width: 2383.94, height: 1683.78 };
const A4 = { width: 595.28, height: 841.89 };

describe("box size", () => {
  test("scales with the sheet", () => {
    expect(boxMetrics(A1).fontSize).toBeCloseTo(20.2, 1);
    expect(boxMetrics(A4).fontSize).toBeCloseTo(7.1, 1);
  });

  test("defaults to the top right, 15 mm in on every sheet size", () => {
    for (const page of [A1, A4]) {
      expect(boxMetrics(page).margin).toBeCloseTo((15 / 25.4) * 72, 2);
      const p = defaultBoxPosition(page);
      const m = boxMetrics(page);
      expect(p.x * page.width + m.width).toBeCloseTo(page.width - m.margin);
      expect(p.y * page.height).toBeCloseTo(m.margin);
    }
  });

  test("its own width and text size (engineer, 2026-10-20)", () => {
    const m = boxMetrics(A1);
    // L text is 1.3 times M; unresized, the box widens with it.
    expect(boxMetrics(A1, { textSize: "L" }).fontSize).toBeCloseTo(
      m.fontSize * 1.3,
    );
    expect(boxMetrics(A1, { textSize: "S" }).width).toBeCloseTo(m.width * 0.8);
    // A set width stays, within limits.
    expect(boxMetrics(A1, { width: 0.2 }).width).toBeCloseTo(A1.width * 0.2);
    const { min, max } = boxWidthLimits(A1);
    expect(boxMetrics(A1, { width: 0.001 }).width).toBeCloseTo(min * A1.width);
    expect(boxMetrics(A1, { width: 2 }).width).toBeCloseTo(max * A1.width);
  });

  test("clamps a dragged box onto the page", () => {
    const p = clampBoxPosition({ x: 1.5, y: -0.2 }, A1);
    expect(p.y).toBe(0);
    expect(p.x * A1.width + boxMetrics(A1).width).toBeCloseTo(A1.width);
  });
});

describe("header line", () => {
  test("formats every part", () => {
    expect(
      boxHeader({
        itemInspected: "Level 3 slab reinforcement",
        inspector: "Test Engineer",
        date: "2026-10-01",
      }),
    ).toBe(
      "NORTHROP INSPECTION | Level 3 slab reinforcement | T. Engineer | 01/10/2026",
    );
  });

  test("leaves out empty parts", () => {
    expect(
      boxHeader({ itemInspected: " ", inspector: "", date: "2026-10-01" }),
    ).toBe("NORTHROP INSPECTION | 01/10/2026");
  });

  test.each([
    ["Test Engineer", "T. Engineer"],
    ["  alex  van der berg ", "A. berg"],
    ["J. R. Smith", "J. Smith"],
    ["Madonna", "Madonna"],
    ["", ""],
  ])("initialAndSurname(%j) is %j", (name, expected) => {
    expect(initialAndSurname(name)).toBe(expected);
  });
});

test("observation lines are in letter order and skip instructions", () => {
  const item = (letter: string, kind: Item["kind"], text: string) =>
    ({ letter, kind, text }) as Item;
  expect(
    observationLines([
      item("AA", "observation", "Late one"),
      item("D", "observation", "Existing crack noted at grid 4"),
      item("B", "instruction", "Add bar"),
      item("C", "observation", ""),
    ]),
  ).toEqual(["C.", "D. Existing crack noted at grid 4", "AA. Late one"]);
});

describe("boxLines", () => {
  const item = (letter: string, kind: Item["kind"], text: string) =>
    ({ letter, kind, text }) as Item;

  test("header, then observations, then instructions, all in capitals", () => {
    expect(
      boxLines({
        header: "NORTHROP INSPECTION | Level 3 slab | T. Engineer | 01/10/2026",
        observationHeading: "Noted for information:",
        items: [
          item("B", "observation", "Existing crack noted at grid 4"),
          item("C", "instruction", "Prop spacing per shop drawing"),
          item("A", "instruction", "Add N12 bar at grid C/4"),
        ],
      }),
    ).toEqual([
      {
        style: "header",
        tone: "header",
        text: "NORTHROP INSPECTION | LEVEL 3 SLAB | T. ENGINEER | 01/10/2026",
      },
      { style: "heading", tone: "observation", text: "NOTED FOR INFORMATION:" },
      {
        style: "item",
        tone: "observation",
        text: "B. EXISTING CRACK NOTED AT GRID 4",
      },
      { style: "heading", tone: "instruction", text: "INSTRUCTIONS:" },
      {
        style: "item",
        tone: "instruction",
        text: "A. ADD N12 BAR AT GRID C/4",
      },
      {
        style: "item",
        tone: "instruction",
        text: "C. PROP SPACING PER SHOP DRAWING",
      },
    ]);
  });

  test("an instruction needing photo confirmation ends with *", () => {
    const lines = boxLines({
      header: "H",
      observationHeading: "Noted for information:",
      items: [
        {
          ...item("A", "instruction", "Add bar"),
          requiresPhotoConfirmation: true,
        },
        item("B", "instruction", "Prop"),
        // Only instructions carry it.
        {
          ...item("A", "observation", "Crack"),
          requiresPhotoConfirmation: true,
        },
      ],
    });
    expect(lines.map((l) => l.text)).toEqual([
      "H",
      "NOTED FOR INFORMATION:",
      "A. CRACK",
      "INSTRUCTIONS:",
      "A. ADD BAR *",
      "B. PROP",
    ]);
  });

  test("leaves out a section with no items", () => {
    const lines = boxLines({
      header: "H",
      observationHeading: "Noted for information:",
      items: [item("A", "observation", "x")],
    });
    expect(lines.map((l) => l.text)).toEqual([
      "H",
      "NOTED FOR INFORMATION:",
      "A. X",
    ]);
  });
});
