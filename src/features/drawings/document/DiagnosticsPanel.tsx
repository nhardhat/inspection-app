import { Activity, Copy, X } from "lucide-react";
import { useEffect, useState, type RefObject } from "react";
import { appCommit, appVersion } from "../../../app/version";
import { diagnostics } from "./diagnostics";
import {
  diagnosticsReport,
  type LiveCounts,
  type ReportLine,
} from "./diagnosticsReport";

/** How often the panel reads the numbers again. */
const REFRESH_MS = 500;

/** Canvases in the app, and the marks on the pages on screen. */
function liveCounts(viewer: HTMLElement | null): LiveCounts {
  let canvases = 0;
  let canvasPixels = 0;
  for (const c of document.querySelectorAll("canvas")) {
    if (c.width * c.height === 0) continue;
    canvases += 1;
    canvasPixels += c.width * c.height;
  }
  let marks = 0;
  let segments = 0;
  for (const key of diagnostics.view?.visibleKeys ?? []) {
    const page = viewer?.querySelector(
      `.doc-page[data-key="${CSS.escape(key)}"]`,
    );
    if (!page) continue;
    for (const mark of page.querySelectorAll("[data-tool]")) {
      marks += 1;
      for (const path of mark.querySelectorAll("path"))
        segments += (path.getAttribute("d") ?? "").match(/[LC]/g)?.length ?? 0;
    }
  }
  return { canvases, canvasPixels, marks, segments };
}

function reportText(lines: ReportLine[]) {
  const head = `Northrop Hardhat ${appVersion} (${appCommit}) · ${new Date().toLocaleString("en-AU")}`;
  return [head, ...lines.map((l) => (l.indent ? `  ${l.text}` : l.text))].join(
    "\n",
  );
}

/**
 * The drawing viewer's diagnostics (Settings, Drawing; step 10): what each
 * page on screen was drawn at against what it wanted, canvas memory, marks,
 * scroll smoothness, PDF open time and render errors, for a screenshot or
 * Copy from the iPad.
 */
export function DiagnosticsPanel({
  viewerRef,
}: {
  viewerRef: RefObject<HTMLDivElement | null>;
}) {
  const [open, setOpen] = useState(true);
  const [lines, setLines] = useState<ReportLine[]>([]);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    diagnostics.enabled = true;
    const read = () =>
      setLines(
        diagnosticsReport(
          diagnostics,
          liveCounts(viewerRef.current),
          performance.now(),
        ),
      );
    read();
    const id = window.setInterval(read, REFRESH_MS);
    return () => {
      diagnostics.enabled = false;
      window.clearInterval(id);
    };
  }, [viewerRef]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(reportText(lines));
      setCopied("Copied");
    } catch {
      setCopied("Couldn't copy");
    }
    window.setTimeout(() => setCopied(null), 2000);
  }

  if (!open)
    return (
      <button
        type="button"
        className="diagnostics-chip"
        onClick={() => setOpen(true)}
      >
        <Activity aria-hidden="true" /> Diagnostics
      </button>
    );

  return (
    <section
      className="diagnostics"
      aria-label="Diagnostics"
      data-testid="diagnostics"
    >
      <header>
        <h2>Diagnostics</h2>
        <button type="button" onClick={() => void copy()}>
          <Copy aria-hidden="true" /> {copied ?? "Copy"}
        </button>
        <button
          type="button"
          aria-label="Hide diagnostics"
          onClick={() => setOpen(false)}
        >
          <X aria-hidden="true" />
        </button>
      </header>
      <ul>
        {lines.map((line, i) => (
          <li
            key={i}
            className={[
              line.indent ? "indent" : "",
              line.heading ? "heading" : "",
              line.tone ? `tone-${line.tone}` : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {line.text}
          </li>
        ))}
      </ul>
    </section>
  );
}
