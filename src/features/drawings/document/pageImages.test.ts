import { describe, expect, it } from "vitest";
import { covers, queuePageDrawing, sharpTarget } from "./pageImages";

const tick = () => new Promise((r) => setTimeout(r, 0));

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
