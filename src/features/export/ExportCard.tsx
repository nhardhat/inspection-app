import { useLiveQuery } from "dexie-react-hooks";
import { PdfViewer } from "../../app/PdfViewer";
import { FileDown, FileSpreadsheet, FileText, FileType } from "lucide-react";
import { useState } from "react";
import { db } from "../../db/db";
import { markMemoExported } from "../../db/memos";
import { formatBytes } from "../../db/storage";
import { formatDateTime } from "../../lib/dates";
import { saveFiles } from "../photos/savePhotos";
import { changesSinceExport, letterSnapshot } from "./exportedLetters";
import { packSummary, packWarnings } from "./packContents";
import { blobLoader, loadPackData } from "./packData";

type State =
  | { status: "idle" }
  | { status: "building"; fraction: number; label: string }
  | { status: "done"; file: File; pages: number; at: number }
  | { status: "error"; message: string };

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * Site memo step: builds the PDF pack (memo, marked-up drawings, photo
 * appendix; SPEC section 7) and shares it. The PDF is built first so the
 * Share tap can open the Share sheet straight away (iPadOS only allows it
 * straight after a tap).
 */
export function ExportCard({ inspectionId }: { inspectionId: string }) {
  const data = useLiveQuery(
    () => loadPackData(db, inspectionId),
    [inspectionId],
  );
  const [state, setState] = useState<State>({ status: "idle" });
  // The pack shown in the app's PDF viewer (it has a Back button).
  const [previewing, setPreviewing] = useState<File | null>(null);

  if (data === undefined) return null;

  const header = (
    <h2 className="section-title">
      <FileDown aria-hidden="true" /> Export
    </h2>
  );
  if (data === null)
    return (
      <section className="card page-section export-card">
        {header}
        <p className="muted">
          Create the memo first: the PDF starts with it, then the marked-up
          drawings and the photos.
        </p>
      </section>
    );

  const summary = packSummary(data);
  const warnings = packWarnings(data);
  const { memo } = data;
  const changes =
    memo.exportedAt && memo.exportedLetters
      ? changesSinceExport(memo.exportedLetters, data.items)
      : [];
  const building = state.status === "building";

  async function exportPdf() {
    if (!data) return;
    setState({ status: "building", fraction: 0, label: "Memo" });
    try {
      // Read again so the very latest typing (saved on blur) is included.
      const fresh = (await loadPackData(db, inspectionId)) ?? data;
      const [{ buildPack }, { loadMemoAssets }] = await Promise.all([
        import("./buildPack"),
        import("../memo/pdf/loadMemoAssets"),
      ]);
      const pack = await buildPack(
        fresh,
        await loadMemoAssets(),
        blobLoader(db),
        (p) => setState({ status: "building", ...p }),
      );
      const at = Date.now();
      await markMemoExported(
        db,
        fresh.memo.id,
        letterSnapshot(fresh.items),
        at,
      );
      setPreviewing(null);
      setState({
        status: "done",
        file: new File([pack.bytes.slice().buffer], pack.filename, {
          type: "application/pdf",
        }),
        pages: pack.pages,
        at,
      });
    } catch (e) {
      console.error("Export failed", e);
      const name =
        e instanceof Error && "drawingName" in e ? String(e.drawingName) : null;
      setState({
        status: "error",
        message: name
          ? `The drawing "${name}" couldn't be read, so the PDF wasn't made. Try deleting it and adding the PDF again.`
          : "The PDF couldn't be made. Your work is still saved; try again.",
      });
    }
  }

  return (
    <section
      className="card page-section export-card"
      aria-labelledby="export-heading"
      data-testid="export-card"
    >
      <h2 id="export-heading" className="section-title">
        <FileDown aria-hidden="true" /> Export
      </h2>

      {changes.length > 0 && (
        <div className="notice" role="status" data-testid="letters-changed">
          <p>
            <strong>
              Letters changed since the export on{" "}
              {formatDateTime(memo.exportedAt!)}.
            </strong>{" "}
            {changes.slice(0, 3).join("; ")}
            {changes.length > 3 ? `; and ${changes.length - 3} more` : ""}.
            Export again before sending.
          </p>
        </div>
      )}

      {state.status === "done" ? (
        <>
          <div className="export-file" data-testid="export-file">
            <FileText aria-hidden="true" />
            <div className="list-row-main">
              <strong className="export-file-name">{state.file.name}</strong>
              <span className="muted">
                {plural(state.pages, "page")} · {formatBytes(state.file.size)} ·
                exported {formatDateTime(state.at)}
              </span>
            </div>
          </div>
          <div className="button-row">
            <button
              type="button"
              className="emphasis"
              onClick={() => void saveFiles([state.file])}
            >
              {changes.length > 0 ? "Share old PDF…" : "Share…"}
            </button>
            <button type="button" onClick={() => setPreviewing(state.file)}>
              Preview
            </button>
            <button
              type="button"
              className={changes.length > 0 ? "primary" : ""}
              onClick={() => void exportPdf()}
            >
              Export again
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="muted">
            One PDF: the memo, the marked-up drawings, then the photos.
          </p>
          <ul className="export-contents" aria-label="What the PDF holds">
            <li>
              <span>Memo</span>
              <span className="muted">{memo.reference}</span>
            </li>
            <li>
              <span>Marked-up drawings</span>
              <span className="muted">
                {summary.drawingPages
                  ? summary.includedPages
                    ? `${plural(summary.drawingPages, "page")} (${summary.includedPages} without pins)`
                    : `${plural(summary.drawingPages, "page")} with pins`
                  : "None (no pins yet)"}
              </span>
            </li>
            <li>
              <span>Photo appendix</span>
              <span className="muted">
                {summary.photos
                  ? `${plural(summary.photos, "photo")} · ${plural(summary.appendixPages, "page")}`
                  : "No photos"}
              </span>
            </li>
          </ul>
          {warnings.length > 0 && !building && (
            <div className="notice" data-testid="export-warnings">
              {warnings.map((w) => (
                <p key={w}>{w}</p>
              ))}
            </div>
          )}
          {state.status === "error" && (
            <p role="alert" className="error">
              {state.message}
            </p>
          )}
          {building ? (
            <div className="export-progress" role="status">
              <progress
                max={1}
                value={state.fraction}
                aria-label="Building the PDF"
              />
              <span className="muted">Building the PDF… {state.label}</span>
            </div>
          ) : (
            <div className="button-row">
              <button
                type="button"
                className="primary"
                onClick={() => void exportPdf()}
              >
                Export PDF
              </button>
            </div>
          )}
        </>
      )}
      <WordMemo inspectionId={inspectionId} />
      <DefectRegister inspectionId={inspectionId} />
      {previewing && (
        <PdfViewer
          title={previewing.name}
          load={() => previewing.arrayBuffer()}
          onClose={() => setPreviewing(null)}
          onShare={() => void saveFiles([previewing])}
        />
      )}
    </section>
  );
}

/**
 * The defect register (Excel; engineer, 2026-10-20): one row per item for
 * the builder to close out. Made first, then shared from a tap, as the PDF.
 */
function DefectRegister({ inspectionId }: { inspectionId: string }) {
  const [state, setState] = useState<
    | { status: "idle" | "building" }
    | { status: "done"; file: File }
    | { status: "error" }
  >({ status: "idle" });

  async function make() {
    setState({ status: "building" });
    try {
      const data = await loadPackData(db, inspectionId);
      if (!data) return setState({ status: "idle" });
      const [{ buildRegisterXlsx, registerFilename }, { loadWordmark }] =
        await Promise.all([
          import("./defectRegister"),
          import("../memo/pdf/loadMemoAssets"),
        ]);
      const bytes = await buildRegisterXlsx(data, await loadWordmark());
      setState({
        status: "done",
        file: new File([bytes.slice().buffer], registerFilename(data), {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      });
    } catch (e) {
      console.error("Defect register failed", e);
      setState({ status: "error" });
    }
  }

  return (
    <div className="defect-register" data-testid="defect-register">
      <h3 className="defect-register-title">
        <FileSpreadsheet aria-hidden="true" /> Defect register (Excel)
      </h3>
      {state.status === "done" ? (
        <>
          <p className="muted">
            <strong className="export-file-name">{state.file.name}</strong>
            {" · "}
            {formatBytes(state.file.size)}
          </p>
          <div className="button-row">
            <button
              type="button"
              className="emphasis"
              onClick={() => void saveFiles([state.file])}
            >
              Share register…
            </button>
            <button type="button" onClick={() => void make()}>
              Make again
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="muted">
            One row per item, with Status, Date closed and Comments columns for
            the builder.
          </p>
          {state.status === "error" && (
            <p role="alert" className="error">
              The register couldn&rsquo;t be made. Your work is still saved; try
              again.
            </p>
          )}
          <div className="button-row">
            <button
              type="button"
              disabled={state.status === "building"}
              onClick={() => void make()}
            >
              {state.status === "building"
                ? "Making the register…"
                : "Export defect register"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The memo and photo appendix as a Word document (engineer, 2026-10-20):
 * made first, then shared from a tap. The drawings stay in the PDF.
 */
function WordMemo({ inspectionId }: { inspectionId: string }) {
  const [state, setState] = useState<
    | { status: "idle" | "building" }
    | { status: "done"; file: File }
    | { status: "error" }
  >({ status: "idle" });

  async function make() {
    setState({ status: "building" });
    try {
      const data = await loadPackData(db, inspectionId);
      if (!data) return setState({ status: "idle" });
      const [{ buildWordMemo, wordFilename }, { loadWordAssets }] =
        await Promise.all([
          import("./wordMemo"),
          import("../memo/pdf/loadMemoAssets"),
        ]);
      const bytes = await buildWordMemo(
        data,
        await loadWordAssets(),
        blobLoader(db),
      );
      setState({
        status: "done",
        file: new File([bytes.slice().buffer], wordFilename(data), {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
      });
    } catch (e) {
      console.error("Word memo failed", e);
      setState({ status: "error" });
    }
  }

  return (
    <div className="defect-register" data-testid="word-memo">
      <h3 className="defect-register-title">
        <FileType aria-hidden="true" /> Memo in Word
      </h3>
      {state.status === "done" ? (
        <>
          <p className="muted">
            <strong className="export-file-name">{state.file.name}</strong>
            {" · "}
            {formatBytes(state.file.size)}
          </p>
          <div className="button-row">
            <button
              type="button"
              className="emphasis"
              onClick={() => void saveFiles([state.file])}
            >
              Share Word file…
            </button>
            <button type="button" onClick={() => void make()}>
              Make again
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="muted">
            The memo and photo appendix as an editable Word document (the
            drawings stay in the PDF).
          </p>
          {state.status === "error" && (
            <p role="alert" className="error">
              The Word file couldn&rsquo;t be made. Your work is still saved;
              try again.
            </p>
          )}
          <div className="button-row">
            <button
              type="button"
              disabled={state.status === "building"}
              onClick={() => void make()}
            >
              {state.status === "building"
                ? "Making the Word file…"
                : "Export Word"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
