import { FileDown } from "lucide-react";
import { STORAGE_FULL_MESSAGE, isStorageFull } from "../../db/storage";
import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  importInspection,
  type ImportMode,
  type InspectionData,
} from "../../db/backup";
import { db } from "../../db/db";
import { formatDateTime } from "../../lib/dates";
import { tabPath } from "../inspections/tabPath";
import { InspectionFileError, unpackInspection } from "./inspectionFile";

interface Chosen {
  data: InspectionData;
  blobs: Map<string, Uint8Array>;
  /** When the same inspection is already here, when it was last edited. */
  existingEditedAt: number | null;
  /** Whether its project (or one with its job number) is already here. */
  projectHere: boolean;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/**
 * Inspections page: Import inspection… opens Files for an inspection file
 * (SPEC section 9), shows what's in it and imports it. An inspection that's
 * already here is never overwritten without asking: Replace or Keep both.
 */
export function ImportInspection() {
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const navigate = useNavigate();
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (chosen && !d.open) d.showModal();
    if (!chosen && d.open) d.close();
  }, [chosen]);

  async function choose(file: File) {
    setError(null);
    try {
      const { data, blobs } = unpackInspection(
        new Uint8Array(await file.arrayBuffer()),
      );
      const existing = await db.inspections.get(data.inspection.id);
      const project = data.project;
      const projectHere = project
        ? Boolean(await db.projects.get(project.id)) ||
          (await db.projects
            .filter(
              (p) =>
                p.jobNumber.trim().toUpperCase() ===
                project.jobNumber.trim().toUpperCase(),
            )
            .count()) > 0
        : false;
      setChosen({
        data,
        blobs,
        existingEditedAt: existing?.updatedAt ?? null,
        projectHere,
      });
    } catch (e) {
      console.error("Import failed", e);
      setError(
        e instanceof InspectionFileError
          ? e.message
          : "That file couldn't be read.",
      );
    }
  }

  async function run(mode: ImportMode) {
    if (!chosen) return;
    setBusy(true);
    try {
      const id = await importInspection(db, chosen.data, chosen.blobs, mode);
      setChosen(null);
      navigate(tabPath(id, "details"));
    } catch (e) {
      console.error("Import failed", e);
      setError(
        isStorageFull(e)
          ? `The import didn't finish; nothing was changed. ${STORAGE_FULL_MESSAGE}`
          : "The import didn't finish. Nothing was changed; try again.",
      );
      setChosen(null);
    } finally {
      setBusy(false);
    }
  }

  const data = chosen?.data;
  const instructions = data?.items.filter(
    (i) => i.kind === "instruction",
  ).length;
  const pages = data?.drawings.reduce(
    (n, d) => n + d.pages.filter((p) => !p.hidden).length,
    0,
  );

  return (
    <>
      <button type="button" onClick={() => input.current?.click()}>
        <FileDown aria-hidden="true" /> Import inspection…
      </button>
      {/* No type filter: iPadOS greys out unfamiliar file types. */}
      <input
        ref={input}
        type="file"
        hidden
        data-testid="import-file-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void choose(file);
        }}
      />
      {error && (
        <p role="alert" className="error import-error">
          {error}
        </p>
      )}
      <dialog
        ref={dialog}
        className="confirm-dialog wide"
        aria-labelledby={titleId}
        onCancel={(e) => {
          e.preventDefault();
          if (!busy) setChosen(null);
        }}
      >
        {data && chosen && (
          <>
            <h2 id={titleId}>
              Import &ldquo;{data.inspection.itemInspected || "Inspection"}
              &rdquo;?
            </h2>
            <ul className="export-contents" aria-label="What the file holds">
              <li>
                <span>Project</span>
                <span className="muted">
                  {data.project
                    ? `${data.project.jobNumber} – ${data.project.jobName}${chosen.projectHere ? " (already here)" : ""}`
                    : "None yet"}
                </span>
              </li>
              <li>
                <span>Drawings</span>
                <span className="muted">
                  {plural(data.drawings.length, "drawing")} ·{" "}
                  {plural(pages ?? 0, "page")}
                </span>
              </li>
              <li>
                <span>Pins</span>
                <span className="muted">
                  {data.items.length} (
                  {plural(instructions ?? 0, "instruction")},{" "}
                  {plural(
                    data.items.length - (instructions ?? 0),
                    "observation",
                  )}
                  )
                </span>
              </li>
              <li>
                <span>Photos</span>
                <span className="muted">{data.photos.length}</span>
              </li>
              <li>
                <span>Memo</span>
                <span className="muted">
                  {data.memo?.reference ?? "None yet"}
                </span>
              </li>
            </ul>
            {chosen.existingEditedAt !== null && (
              <p className="notice" data-testid="import-exists">
                This inspection is already on this device (edited{" "}
                {formatDateTime(chosen.existingEditedAt)}). Replace it with the
                file&rsquo;s copy, or keep both?
              </p>
            )}
            <p className="button-row dialog-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => setChosen(null)}
              >
                Cancel
              </button>
              {chosen.existingEditedAt !== null ? (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run("keepBoth")}
                  >
                    Keep both
                  </button>
                  <button
                    type="button"
                    className="emphasis"
                    disabled={busy}
                    onClick={() => void run("replace")}
                  >
                    Replace
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="emphasis"
                  disabled={busy}
                  onClick={() => void run("new")}
                >
                  Import
                </button>
              )}
            </p>
          </>
        )}
      </dialog>
    </>
  );
}
