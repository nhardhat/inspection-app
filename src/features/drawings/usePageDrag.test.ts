import { describe, expect, test } from "vitest";
import { dropTarget, type DragEntry } from "./usePageDrag";

const page = (drawingId: string, position: number, number: number) =>
  ({
    key: `${drawingId}:${position}`,
    drawingId,
    drawingName: drawingId === "a" ? "S-101" : "S-102",
    position,
    number,
  }) satisfies DragEntry;

describe("dropTarget", () => {
  const a1 = page("a", 1, 1);
  const a2 = page("a", 2, 2);
  const a3 = page("a", 3, 3);
  const b1 = page("b", 1, 4);

  test("into another drawing: before or after the page under the finger", () => {
    expect(dropTarget(a2, b1, "before")).toMatchObject({
      drawingId: "b",
      toPosition: 1,
      label: "Move to S-102, before page 4",
    });
    expect(dropTarget(a2, b1, "after")).toMatchObject({
      drawingId: "b",
      toPosition: 2,
      label: "Move to S-102, after page 4",
    });
  });

  test("within its drawing, places count once it has left its own", () => {
    expect(dropTarget(a1, a3, "after")).toMatchObject({ toPosition: 3 });
    expect(dropTarget(a3, a1, "before")).toMatchObject({ toPosition: 1 });
    // Beside itself: no move.
    expect(dropTarget(a2, a1, "after")).toBeNull();
    expect(dropTarget(a2, a3, "before")).toBeNull();
  });
});
