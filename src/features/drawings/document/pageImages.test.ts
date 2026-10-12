import { afterEach, describe, expect, it } from "vitest";
import {
  PIECE_PX,
  clearPageImages,
  covers,
  distanceTo,
  piecesCost,
  sharpPieces,
  sharpTarget,
  keepPageImage,
  queuePageDrawing,
  takePageImage,
} from "./pageImages";

/** A stand-in canvas (the tests run without a DOM). */
function canvas(width: number, height: number) {
  return { width, height, remove() {} } as unknown as HTMLCanvasElement;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => clearPageImages());

describe("kept page images", () => {
  it("hands a kept image back once, at the same scale only", () => {
    const c = canvas(2000, 1400);
    keepPageImage("d:1@1", c, 1);
    expect(takePageImage("d:1@1", 1.5)).toBeNull();
    // Taken at the wrong scale, it was let go.
    expect(c.width).toBe(0);
    const d = canvas(2000, 1400);
    keepPageImage("d:1@1", d, 1);
    expect(takePageImage("d:1@1", 1.005)).toBe(d);
    expect(takePageImage("d:1@1", 1)).toBeNull();
  });

  it("lets the oldest go beyond about four A1 pages", () => {
    const kept = [1, 2, 3, 4, 5].map((n) => {
      const c = canvas(2380, 1680); // 4 MP
      keepPageImage(`d:${n}@${n}`, c, 1);
      return c;
    });
    expect(kept[0].width).toBe(0);
    expect(takePageImage("d:1@1", 1)).toBeNull();
    expect(takePageImage("d:5@5", 1)).toBe(kept[4]);
  });
});

describe("page drawing queue", () => {
  it("draws one page at a time, pages on screen first", async () => {
    const order: string[] = [];
    const finish = new Map<string, () => void>();
    const job = (name: string) => (done: () => void) => {
      order.push(name);
      finish.set(name, done);
      return () => order.push(`cancel ${name}`);
    };
    queuePageDrawing(1, job("near"));
    queuePageDrawing(0, job("visible"));
    queuePageDrawing(1, job("near 2"));
    await tick();
    expect(order).toEqual(["visible"]);
    finish.get("visible")!();
    expect(order).toEqual(["visible", "near"]);
    finish.get("near")!();
    expect(order).toEqual(["visible", "near", "near 2"]);
    finish.get("near 2")!();
  });

  it("cancels a running drawing and starts the next", async () => {
    const order: string[] = [];
    const cancelFirst = queuePageDrawing(0, () => {
      order.push("first");
      return () => order.push("cancel first");
    });
    queuePageDrawing(0, (done) => {
      order.push("second");
      done();
      return () => {};
    });
    await tick();
    cancelFirst();
    expect(order).toEqual(["first", "cancel first", "second"]);
  });

  it("pauses background work for a page on screen, then runs it again", async () => {
    const order: string[] = [];
    const finish = new Map<string, () => void>();
    const job = (name: string) => (done: () => void) => {
      order.push(name);
      finish.set(name, done);
      return () => order.push(`pause ${name}`);
    };
    queuePageDrawing(2, job("background"));
    await tick();
    queuePageDrawing(0, job("visible"));
    expect(order).toEqual(["background", "pause background"]);
    await tick();
    expect(order).toEqual(["background", "pause background", "visible"]);
    // The paused run ending late changes nothing.
    finish.get("background")!();
    expect(order.at(-1)).toBe("visible");
    finish.get("visible")!();
    expect(order.at(-1)).toBe("background");
    finish.get("background")!();
  });

  it("drops a waiting drawing that's cancelled before it starts", async () => {
    const order: string[] = [];
    let finishFirst = () => {};
    queuePageDrawing(0, (done) => {
      order.push("first");
      finishFirst = done;
      return () => {};
    });
    const cancelSecond = queuePageDrawing(0, () => {
      order.push("second");
      return () => {};
    });
    await tick();
    cancelSecond();
    finishFirst();
    expect(order).toEqual(["first"]);
  });
});

describe("sharp image area", () => {
  // A B1 sheet in points, a quarter of it on screen.
  const page = { width: 2835, height: 2004 };
  const part = { x: 1000, y: 700, width: 700, height: 500 };

  it("covers half a view round what's on screen when the budget allows", () => {
    const { rect, scale } = sharpTarget(page, part, 2, 12_000_000);
    expect(scale).toBe(2);
    expect(rect).toEqual({ x: 650, y: 450, width: 1400, height: 1000 });
    expect(covers(rect, part)).toBe(true);
  });

  it("gives up margin before detail", () => {
    // 3 MP at 2 px/pt allows 750,000 pt²: half a view (1400 x 1000) and a
    // quarter (1050 x 750) are too big; a tenth (840 x 600) fits.
    const { rect, scale } = sharpTarget(page, part, 2, 3_000_000);
    expect(scale).toBe(2);
    expect(rect.width).toBeCloseTo(840);
  });

  it("lowers the detail only when even the view alone is too big", () => {
    const { rect, scale } = sharpTarget(page, part, 4, 2_000_000);
    expect(rect).toEqual(part);
    expect(scale).toBeCloseTo(Math.sqrt(2_000_000 / (700 * 500)));
  });

  it("stays within the page", () => {
    const corner = { x: 0, y: 0, width: 700, height: 500 };
    const { rect } = sharpTarget(page, corner, 1, 12_000_000);
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(0);
  });
});

describe("sharp pieces", () => {
  const page = { width: 2835, height: 2004 };

  it("covers the area with a grid fixed to the page", () => {
    // At 2 px/pt a piece is 512 pt square.
    const area = { x: 600, y: 100, width: 600, height: 500 };
    const pieces = sharpPieces(page, area, 2);
    expect(pieces.map((p) => p.key)).toEqual(["1,0", "2,0", "1,1", "2,1"]);
    expect(pieces[0].rect).toEqual({ x: 512, y: 0, width: 512, height: 512 });
    expect(pieces[0].width).toBe(PIECE_PX);
    // Panning a little reuses the same cells.
    const panned = sharpPieces(page, { ...area, x: 620 }, 2);
    expect(panned.map((p) => p.key)).toEqual(pieces.map((p) => p.key));
  });

  it("keeps the pieces, not just the area, within the budget", () => {
    const part = { x: 1000, y: 700, width: 700, height: 500 };
    const { rect, scale } = sharpTarget(page, part, 2, 7_000_000, (area, at) =>
      piecesCost(page, area, at),
    );
    expect(scale).toBe(2);
    expect(piecesCost(page, rect, scale)).toBeLessThanOrEqual(7_000_000);
    expect(covers(rect, part)).toBe(true);
  });

  it("never lowers the detail for whole pieces going over", () => {
    // The view alone is 1.4 MP at 2 px/pt, but its six pieces are 6.3 MP.
    const part = { x: 1000, y: 700, width: 700, height: 500 };
    const { rect, scale } = sharpTarget(page, part, 2, 6_000_000, (area, at) =>
      piecesCost(page, area, at),
    );
    expect(scale).toBe(2);
    expect(rect).toEqual(part);
  });

  it("trims pieces at the page's edge", () => {
    const pieces = sharpPieces(
      page,
      { x: 2700, y: 1900, width: 135, height: 104 },
      2,
    );
    expect(pieces).toHaveLength(1);
    expect(pieces[0].rect.width).toBeCloseTo(2835 - 2560);
    expect(pieces[0].width).toBe(Math.ceil((2835 - 2560) * 2));
  });

  it("measures how far a piece is from the view", () => {
    const view = { x: 100, y: 100, width: 100, height: 100 };
    expect(distanceTo({ x: 150, y: 150, width: 10, height: 10 }, view)).toBe(0);
    expect(distanceTo({ x: 230, y: 100, width: 10, height: 10 }, view)).toBe(
      30,
    );
  });
});
