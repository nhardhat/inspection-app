import { describe, expect, test } from "vitest";
import { memoFilename } from "./memoFilename";
import {
  conditionsLeadIn,
  confirmationParagraph,
  formatMemoDate,
  referenceLine,
} from "./memoTemplate";

describe("memo template text", () => {
  test("conditions lead-in depends on whether there are conditions", () => {
    expect(conditionsLeadIn(2)).toBe("Ok to proceed subject to the following:");
    expect(conditionsLeadIn(0)).toBe("Ok to proceed.");
    // Instructions needing photos: the photo line joins it.
    expect(
      conditionsLeadIn(2, "Items marked * to be closed out with photos."),
    ).toBe(
      "Ok to proceed subject to the following. Items marked * to be closed out with photos:",
    );
    expect(conditionsLeadIn(2, "  ")).toBe(
      "Ok to proceed subject to the following:",
    );
  });

  test("confirmation paragraph", () => {
    expect(confirmationParagraph("Level 3 slab reinforcement")).toBe(
      "We confirm having inspected the Level 3 slab reinforcement as highlighted on the drawing attached.",
    );
  });

  test("reference line", () => {
    expect(referenceLine("SIM-002", "Footings")).toBe("SIM-002 – Footings");
    expect(referenceLine("SIM-002", "")).toBe("SIM-002");
  });

  test("formatMemoDate", () => {
    expect(formatMemoDate("2026-10-01")).toBe("1 October 2026");
    expect(formatMemoDate("2026-12-25")).toBe("25 December 2026");
    expect(formatMemoDate("next Tuesday")).toBe("next Tuesday");
  });
});

describe("memoFilename", () => {
  test("job number, reference, A, item inspected", () => {
    expect(
      memoFilename("SY000001", "SIM001", "Level 3 slab reinforcement"),
    ).toBe("SY000001-SIM001-A-Level 3 slab reinforcement.pdf");
  });

  test("strips characters that break file systems, keeping spaces", () => {
    expect(memoFilename("SY/01", "SSI002", 'Slab:  "east" pour?')).toBe(
      "SY 01-SSI002-A-Slab east pour.pdf",
    );
  });

  test("falls back to memo.pdf when everything is empty", () => {
    expect(memoFilename("", "", "")).toBe("memo.pdf");
  });
});
