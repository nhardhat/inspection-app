/**
 * The diagnostics panel's lines (step 10), shared by the panel and its Copy
 * button. Page numbers and paper sizes only, never drawing names, so a
 * screenshot or copied report gives nothing away about a real project.
 */
import { paperLabel } from "../../../app/paperLabel";
import type { DiagnosticsState, RenderStat } from "./diagnostics";

export interface ReportLine {
  text: string;
  /** A note on the line: "ok" sharp as wanted, "warn" cut back, "bad" failed. */
  tone?: "ok" | "warn" | "bad";
  /** Under a page heading. */
  indent?: boolean;
  /** A page heading. */
  heading?: boolean;
}

/** What the panel measures from the page itself as it refreshes. */
export interface LiveCounts {
  canvases: number;
  canvasPixels: number;
  marks: number;
  /** Straight or curved segments in the marks' outlines. */
  segments: number;
}

const mp = (pixels: number) => `${(pixels / 1e6).toFixed(1)} MP`;
const ms = (n: number) => `${Math.round(n)} ms`;
const fixed = (n: number) => n.toFixed(2);
const fileSize = (bytes: number) =>
  bytes < 1e6
    ? `${Math.round(bytes / 1e3)} KB`
    : `${(bytes / 1e6).toFixed(1)} MB`;

function renderLine(
  label: string,
  r: RenderStat,
  now: number,
): Omit<ReportLine, "indent"> {
  const share = r.scale / r.wanted;
  const detail =
    share < 0.999
      ? `${fixed(r.scale)} of ${fixed(r.wanted)} (${Math.round(share * 100)}%, ${r.limit ?? "less"})`
      : `${fixed(r.scale)} (as wanted)`;
  const time =
    r.state === "drawing"
      ? `drawing ${ms(now - r.started)}`
      : r.state === "kept"
        ? "kept from earlier"
        : r.state === "saved"
          ? `from saved image · ${ms(r.ms)}`
          : ms(r.ms);
  const state =
    r.state === "failed"
      ? " · FAILED"
      : r.state === "cancelled"
        ? " · cancelled"
        : "";
  const pieces = r.pieces
    ? ` · ${r.pieces.done} of ${r.pieces.total} pieces`
    : "";
  return {
    text: `${label} ${detail} · ${mp(r.pixels)} · ${time}${pieces}${state}`,
    tone: r.state === "failed" ? "bad" : share < 0.999 ? "warn" : "ok",
  };
}

export function diagnosticsReport(
  state: DiagnosticsState,
  live: LiveCounts,
  now: number,
): ReportLine[] {
  const lines: ReportLine[] = [];
  const view = state.view;
  lines.push({
    text: view
      ? `Zoom ${view.zoom.toFixed(1)}× fit · DPR ${view.dpr} · ${view.visibleKeys.length} ${view.visibleKeys.length === 1 ? "page" : "pages"} on screen`
      : "Waiting for the drawing to settle",
  });

  const drawings = new Set<string>();
  for (const key of view?.visibleKeys ?? []) {
    const page = state.pages.get(key);
    if (!page) continue;
    drawings.add(page.drawingId);
    lines.push({
      text: `Page ${page.number} · ${paperLabel(page.widthPt, page.heightPt)}`,
      heading: true,
    });
    if (page.base)
      lines.push({ ...renderLine("Base", page.base, now), indent: true });
    else if (page.preview)
      lines.push(
        { ...renderLine("Preview", page.preview, now), indent: true },
        { text: "Base waits for scrolling to stop", indent: true },
      );
    else lines.push({ text: "Base not drawn yet", indent: true });
    lines.push(
      page.sharp
        ? { ...renderLine("Sharp", page.sharp, now), indent: true }
        : { text: "Sharp not needed (the base is enough)", indent: true },
    );
  }

  lines.push({
    text: `Canvases ${live.canvases} live · ${mp(live.canvasPixels)} total`,
  });
  lines.push({
    text: `Markup ${live.marks.toLocaleString("en-AU")} marks on screen · ${live.segments.toLocaleString("en-AU")} segments`,
  });
  const scroll = state.scroll;
  lines.push({
    text: scroll
      ? `Scroll last ${scroll.seconds.toFixed(1)} s · ${Math.round(scroll.fps)} fps · worst frame ${ms(scroll.worstMs)}${scroll.worstDuring ? ` (during ${scroll.worstDuring})` : ""} · pages drawing ${Math.round(scroll.drawingShare * 100)}% of it`
      : "Scroll not measured yet (scroll the drawing)",
    tone:
      scroll && (scroll.fps < 45 || scroll.worstMs > 50) ? "warn" : undefined,
  });
  const d = state.drawing;
  if (d)
    lines.push({
      text: `Drawing last ${d.seconds.toFixed(1)} s · longest freeze ${ms(d.longestFreezeMs)}`,
      tone: d.longestFreezeMs > 100 ? "warn" : undefined,
    });
  for (const id of drawings) {
    const pdf = state.pdfs.get(id);
    if (pdf)
      lines.push({
        text: `PDF opened ${(pdf.ms / 1000).toFixed(1)} s · ${fileSize(pdf.bytes)} file`,
      });
  }
  if (state.errors.length === 0) lines.push({ text: "Errors none" });
  for (const e of state.errors) {
    const time = new Date(e.time).toLocaleTimeString("en-AU", {
      hour12: false,
    });
    lines.push({ text: `Error ${time} ${e.message}`, tone: "bad" });
  }
  return lines;
}
