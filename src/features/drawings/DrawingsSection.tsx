import { useLiveQuery } from "dexie-react-hooks";
import { useRef, useState } from "react";
import { FilePlus, FlaskConical, Files, Pencil, Trash2 } from "lucide-react";
import { ConfirmDialog } from "../../app/ConfirmDialog";
import { useRowDrag } from "../../app/useRowDrag";
import { db } from "../../db/db";
import {
  listDrawings,
  deleteDrawing,
  drawingNameFromFile,
  renameDrawing,
  reorderDrawings,
} from "../../db/drawings";
import type { Drawing } from "../../db/types";
import { formatBytes } from "../../db/storage";
import { drawingPages } from "./document/documentLayout";
import { storePdf } from "./drawingFiles";

/** "3 pages", or "3 pages (2 hidden)" once pages are hidden. */
function pageSummary(drawing: Drawing) {
  const pages = drawingPages(drawing);
  const hidden = pages.filter((p) => p.hidden).length;
  const shown = pages.length - hidden;
  return `${shown} ${shown === 1 ? "page" : "pages"}${hidden ? ` (${hidden} hidden)` : ""}`;
}

/**
 * An inspection's drawings: add (PDFs from Files, or a synthetic test
 * drawing), rename and delete. In the viewer's Drawings panel, tapping a
 * drawing scrolls to it (`onOpen`); with no drawings yet it fills the view.
 * Drag a drawing's ≡ handle to reorder the document (letters follow).
 */
export function DrawingsSection({
  inspectionId,
  onOpen,
  onActivity,
}: {
  inspectionId: string;
  onOpen?: (drawingId: string) => void;
  /** Reports adding in progress, and whether any file failed. */
  onActivity?: (state: { busy: boolean; failed: boolean }) => void;
}) {
  const drawings = useLiveQuery(
    () => listDrawings(db, inspectionId),
    [inspectionId],
  );
  const counts = useLiveQuery(async () => {
    const items = await db.items
      .where("inspectionId")
      .equals(inspectionId)
      .toArray();
    const byDrawing = new Map<string, number>();
    for (const item of items)
      byDrawing.set(item.drawingId, (byDrawing.get(item.drawingId) ?? 0) + 1);
    return byDrawing;
  }, [inspectionId]);

  const fileInput = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [renaming, setRenaming] = useState<Drawing | null>(null);
  const [newName, setNewName] = useState("");
  const [deleting, setDeleting] = useState<Drawing | null>(null);
  const reorder = useRowDrag(
    (drawings ?? []).map((d) => d.id),
    (order) => void reorderDrawings(db, inspectionId, order),
  );

  async function addFiles(files: File[]) {
    onActivity?.({ busy: true, failed: false });
    const failed: string[] = [];
    for (const [i, file] of files.entries()) {
      setStatus(`Adding ${file.name} (${i + 1} of ${files.length})…`);
      try {
        await storePdf(
          inspectionId,
          drawingNameFromFile(file.name),
          new Uint8Array(await file.arrayBuffer()),
        );
      } catch (e) {
        console.error("Could not add drawing", e);
        failed.push(`${file.name} couldn't be opened as a PDF.`);
      }
    }
    setStatus(null);
    setErrors(failed);
    onActivity?.({ busy: false, failed: failed.length > 0 });
  }

  async function addSynthetic() {
    setStatus("Generating synthetic test drawing…");
    setErrors([]);
    try {
      const { buildSyntheticDrawing, TYPICAL_DRAWING } =
        await import("./fixtures/syntheticDrawing");
      await storePdf(
        inspectionId,
        "Synthetic test drawing",
        await buildSyntheticDrawing(TYPICAL_DRAWING),
      );
    } catch (e) {
      setErrors([`Couldn't create the test drawing: ${String(e)}`]);
    } finally {
      setStatus(null);
    }
  }

  const busy = status !== null;
  const deletingCount = deleting ? (counts?.get(deleting.id) ?? 0) : 0;
  // Its pages moved into other drawings show its PDF: they go with it.
  const deletingLent = deleting
    ? (drawings ?? [])
        .filter((d) => d.id !== deleting.id)
        .flatMap((d) => d.pages ?? [])
        .filter((p) => p.from === deleting.id).length
    : 0;

  return (
    <div className="drawings-section" aria-labelledby="drawings-heading">
      <div className="page-heading">
        <h2 id="drawings-heading" className="section-title">
          <Files aria-hidden="true" /> Drawings
        </h2>
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          <FilePlus aria-hidden="true" /> Add drawings
        </button>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        hidden
        data-testid="drawing-file-input"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) void addFiles(files);
        }}
      />
      {status && (
        <p role="status" data-testid="drawings-status">
          {status}
        </p>
      )}
      {errors.map((message) => (
        <p key={message} role="alert" className="error">
          {message}
        </p>
      ))}

      {drawings && drawings.length === 0 && !busy && (
        <p className="muted drawings-hint">
          No drawings yet. Add the drawing PDFs for this inspection from Files;
          they stay on this iPad, and all their pages scroll as one document.
        </p>
      )}
      {drawings && drawings.length > 0 && (
        <ul className="list-panel" aria-label="Drawings">
          {drawings.map((drawing) => {
            const count = counts?.get(drawing.id) ?? 0;
            return (
              <li
                key={drawing.id}
                ref={reorder.rowRef(drawing.id)}
                className={`list-row reorder-row${reorder.draggingId === drawing.id ? " reorder-row-dragged" : ""}`}
                style={{
                  transform: `translateY(${reorder.shift(drawing.id)}px)`,
                  transition:
                    reorder.draggingId === null ||
                    reorder.draggingId === drawing.id
                      ? "none"
                      : undefined,
                }}
              >
                {drawings.length > 1 && (
                  <button
                    type="button"
                    className="drag-handle"
                    aria-label={`Reorder ${drawing.name}`}
                    title="Drag to reorder"
                    {...reorder.handleProps(drawing.id)}
                  >
                    ≡
                  </button>
                )}
                <button
                  type="button"
                  className="list-row-main link-like"
                  onClick={() => onOpen?.(drawing.id)}
                >
                  <span className="list-row-title">{drawing.name}</span>
                  <span className="list-row-meta">
                    {pageSummary(drawing)} · {count}{" "}
                    {count === 1 ? "item" : "items"}
                    {drawing.fileSize
                      ? ` · ${formatBytes(drawing.fileSize)}`
                      : ""}
                  </span>
                </button>
                <button
                  type="button"
                  className="icon-button quiet"
                  aria-label={`Rename ${drawing.name}`}
                  title="Rename"
                  onClick={() => {
                    setNewName(drawing.name);
                    setRenaming(drawing);
                  }}
                >
                  <Pencil aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="icon-button danger-outline"
                  aria-label={`Delete ${drawing.name}`}
                  title="Delete"
                  onClick={() => setDeleting(drawing)}
                >
                  <Trash2 aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* For trying the app without real drawings. */}
      <button
        type="button"
        className="quiet small test-drawing"
        disabled={busy}
        onClick={() => void addSynthetic()}
      >
        <FlaskConical aria-hidden="true" /> Add synthetic test drawing
      </button>

      <ConfirmDialog
        open={renaming !== null}
        title="Rename drawing"
        confirmLabel="Save"
        wide
        onCancel={() => setRenaming(null)}
        onConfirm={() => {
          if (renaming) void renameDrawing(db, renaming.id, newName);
          setRenaming(null);
        }}
      >
        <label className="field">
          <span>Name</span>
          <input
            name="drawingName"
            value={newName}
            autoCapitalize="words"
            onChange={(e) => setNewName(e.target.value)}
          />
        </label>
      </ConfirmDialog>

      <ConfirmDialog
        open={deleting !== null}
        title="Delete drawing?"
        confirmLabel="Delete"
        danger
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) void deleteDrawing(db, deleting.id);
          setDeleting(null);
        }}
      >
        <p>
          <strong>{deleting?.name}</strong>
          {deletingCount > 0
            ? ` and its ${deletingCount} ${deletingCount === 1 ? "item" : "items"} will be removed from this device.`
            : " will be removed from this device."}
        </p>
        {deletingLent > 0 && (
          <p>
            {deletingLent === 1
              ? "Its page moved into another drawing goes too"
              : `Its ${deletingLent} pages moved into other drawings go too`}
            , with any pins and markup on {deletingLent === 1 ? "it" : "them"}.
          </p>
        )}
        <p>
          This can't be undone. Remaining items are re-lettered so there are no
          gaps.
        </p>
      </ConfirmDialog>
    </div>
  );
}
