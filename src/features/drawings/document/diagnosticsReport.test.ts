import { describe, expect, it } from "vitest";
import type { DiagnosticsState, RenderStat } from "./diagnostics";
import { diagnosticsReport } from "./diagnosticsReport";

const render = (r: Partial<RenderStat>): RenderStat => ({
  scale: 1,
  wanted: 1,
  limit: null,
  pixels: 4_000_000,
  ms: 210,
  state: "done",
  started: 0,
  kind: "base",
  ...r,
});

function state(over: Partial<DiagnosticsState> = {}): DiagnosticsState {
  return {
    enabled: true,
    pages: new Map([
      [
        "d1:4",
        {
          drawingId: "d1",
          number: 4,
          // A1 landscape, in points.
          widthPt: 2384,
          heightPt: 1684,
          base: render({ scale: 0.42, wanted: 0.42 }),
          sharp: render({
            scale: 1.71,
            wanted: 2.8,
            limit: "budget",
            pixels: 6_000_000,
            ms: 640,
          }),
        },
      ],
    ]),
    view: { zoom: 3.2, dpr: 2, visibleKeys: ["d1:4"] },
    scroll: {
      seconds: 2.1,
      fps: 41,
      worstMs: 96,
      drawingShare: 0.4,
      worstDuring: "2 preview",
    },
    pdfs: new Map([["d1", { ms: 1200, bytes: 18_400_000 }]]),
    errors: [],
    drawing: { seconds: 2.4, longestFreezeMs: 140 },
    drawingThread: "background",
    ...over,
  };
}

const live = {
  canvases: 5,
  canvasPixels: 21_300_000,
  marks: 312,
  segments: 4820,
};

describe("diagnosticsReport", () => {
  it("lists each page on screen with what it was drawn at", () => {
    const lines = diagnosticsReport(state(), live, 1000);
    const text = lines.map((l) => l.text);
    expect(text[0]).toBe("Zoom 3.2× fit · DPR 2 · 1 page on screen");
    expect(text).toContain("Page 4 · A1 (841 × 594 mm)");
    expect(text).toContain("Base 0.42 (as wanted) · 4.0 MP · 210 ms");
    expect(text).toContain(
      "Sharp 1.71 of 2.80 (61%, budget) · 6.0 MP · 640 ms",
    );
    expect(lines.find((l) => l.text.startsWith("Sharp"))?.tone).toBe("warn");
    expect(lines.find((l) => l.text.startsWith("Base"))?.tone).toBe("ok");
    expect(text).toContain("Canvases 5 live · 21.3 MP total");
    expect(text).toContain("Markup 312 marks on screen · 4,820 segments");
    expect(text).toContain(
      "Scroll last 2.1 s · 41 fps · worst frame 96 ms (during 2 preview) · pages drawing 40% of it",
    );
    expect(text).toContain("Drawing last 2.4 s · longest freeze 140 ms");
    expect(lines.find((l) => l.text.startsWith("Drawing last"))?.tone).toBe(
      "warn",
    );
    expect(text).toContain("Drawing on the background");
    expect(text).toContain("PDF opened 1.2 s · 18.4 MB file");
    expect(text).toContain("Errors none");
  });

  it("warns when pages are drawn on the main thread", () => {
    const lines = diagnosticsReport(
      state({ drawingThread: "main thread (not supported)" }),
      live,
      1000,
    );
    const line = lines.find((l) => l.text.startsWith("Drawing on"));
    expect(line?.text).toBe("Drawing on the main thread (not supported)");
    expect(line?.tone).toBe("warn");
  });

  it("shows a render in progress, a page needing no sharp render, and errors", () => {
    const s = state({
      errors: [{ time: 0, message: "Page 4 render failed: boom" }],
    });
    const page = s.pages.get("d1:4")!;
    page.base = render({ state: "drawing", started: 400 });
    page.sharp = null;
    const lines = diagnosticsReport(s, live, 1000);
    const text = lines.map((l) => l.text);
    expect(text).toContain("Base 1.00 (as wanted) · 4.0 MP · drawing 600 ms");
    expect(text).toContain("Sharp not needed (the base is enough)");
    const error = lines.find((l) => l.text.startsWith("Error "));
    expect(error?.text).toMatch(/Page 4 render failed: boom$/);
    expect(error?.tone).toBe("bad");
  });

  it("says when a page came from its saved image", () => {
    const s = state();
    s.pages.get("d1:4")!.base = render({
      scale: 0.42,
      wanted: 0.42,
      state: "saved",
      ms: 48,
    });
    const text = diagnosticsReport(s, live, 1000).map((l) => l.text);
    expect(text).toContain(
      "Base 0.42 (as wanted) · 4.0 MP · from saved image · 48 ms",
    );
  });

  it("waits for the view before listing pages", () => {
    const text = diagnosticsReport(
      state({ view: null, scroll: null }),
      live,
      0,
    ).map((l) => l.text);
    expect(text[0]).toBe("Waiting for the drawing to settle");
    expect(text.some((t) => t.startsWith("Page"))).toBe(false);
    expect(text).toContain("Scroll not measured yet (scroll the drawing)");
  });
});
