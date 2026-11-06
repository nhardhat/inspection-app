import { useLiveQuery } from "dexie-react-hooks";
import { CloudUpload, FileArchive } from "lucide-react";
import { useState } from "react";
import { needsBackup } from "../../db/backup";
import { db } from "../../db/db";
import { formatBytes } from "../../db/storage";
import { formatDateTime } from "../../lib/dates";
import { SaveToFolderButton } from "../export/SaveToFolderButton";
import { BACKUPS_FOLDER } from "../export/saveToFolder";
import { saveFiles } from "../photos/savePhotos";
import { buildBackupFile, recordBackups } from "./backupActions";

type State =
  | { status: "idle" }
  | { status: "building" }
  | { status: "ready"; file: File }
  | { status: "error"; message: string };

/**
 * Pre-inspection: back up this inspection to a file (SPEC sections 9 and
 * 10). The file is built first, then Share opens the Share sheet (iPadOS
 * only allows it straight from a tap); it counts as backed up once shared
 * or downloaded.
 */
export function BackupCard({ inspectionId }: { inspectionId: string }) {
  const info = useLiveQuery(async () => {
    const inspection = await db.inspections.get(inspectionId);
    if (!inspection) return null;
    const items = await db.items
      .where("inspectionId")
      .equals(inspectionId)
      .toArray();
    const photos = (
      await db.photos.bulkGet([
        ...items.flatMap((i) => i.photoIds),
        ...(inspection.photoIds ?? []),
      ])
    ).filter((p) => p !== undefined);
    return {
      inspection,
      originalsSize: photos.reduce((n, p) => n + (p.originalSize ?? 0), 0),
    };
  }, [inspectionId]);
  const [includeOriginals, setIncludeOriginals] = useState(false);
  const [state, setState] = useState<State>({ status: "idle" });
  if (!info) return null;
  const { inspection, originalsSize } = info;
  const stale = needsBackup(inspection);

  async function build() {
    setState({ status: "building" });
    try {
      setState({
        status: "ready",
        file: await buildBackupFile(inspectionId, includeOriginals),
      });
    } catch (e) {
      console.error("Backup failed", e);
      setState({
        status: "error",
        message: "The backup couldn't be made. Try again.",
      });
    }
  }

  async function share(file: File) {
    const result = await saveFiles([file]);
    if (result !== "cancelled") await recordBackups([inspectionId]);
  }

  return (
    <section
      className="card detail-card backup-card"
      aria-labelledby="backup-heading"
      data-testid="backup-card"
    >
      <h2 id="backup-heading" className="section-title">
        <CloudUpload aria-hidden="true" /> Backup
      </h2>
      <p>
        <span
          className={`chip ${stale ? "chip-todo" : "chip-ok"}`}
          data-testid="backup-status"
        >
          {inspection.backedUpAt
            ? stale
              ? "Changed since last backup"
              : "Backed up"
            : "Not backed up yet"}
        </span>
      </p>
      <p className="muted">
        {inspection.backedUpAt
          ? `Last backed up ${formatDateTime(inspection.backedUpAt)}. `
          : ""}
        Keep the file off this device (Files › iCloud Drive or OneDrive).
      </p>
      {originalsSize > 0 && state.status !== "ready" && (
        <label className="checkbox switch">
          <input
            type="checkbox"
            checked={includeOriginals}
            onChange={(e) => setIncludeOriginals(e.target.checked)}
          />
          <span>
            Include full-size camera photos
            <span className="muted small backup-hint">
              {" "}
              +{formatBytes(originalsSize)} (working copies are always included)
            </span>
          </span>
        </label>
      )}
      {state.status === "error" && (
        <p role="alert" className="error">
          {state.message}
        </p>
      )}
      {state.status === "ready" ? (
        <>
          <div className="export-file" data-testid="backup-file">
            <FileArchive aria-hidden="true" />
            <div className="list-row-main">
              <strong className="export-file-name">{state.file.name}</strong>
              <span className="muted">{formatBytes(state.file.size)}</span>
            </div>
          </div>
          <div className="button-row">
            <button
              type="button"
              className="emphasis"
              onClick={() => void share(state.file)}
            >
              Share…
            </button>
            <SaveToFolderButton
              file={state.file}
              folderId={BACKUPS_FOLDER}
              onSaved={() => recordBackups([inspectionId])}
            />
            <button type="button" onClick={() => void build()}>
              Back up again
            </button>
          </div>
          <p className="muted small">
            In the Share sheet, choose Save to Files.
          </p>
        </>
      ) : (
        <div className="button-row">
          <button
            type="button"
            className="primary"
            disabled={state.status === "building"}
            onClick={() => void build()}
          >
            {state.status === "building" ? "Preparing…" : "Back up now"}
          </button>
        </div>
      )}
    </section>
  );
}
