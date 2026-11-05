import { useLiveQuery } from "dexie-react-hooks";
import { CloudUpload, FolderDown } from "lucide-react";
import { useState } from "react";
import { needsBackup } from "../../db/backup";
import { db } from "../../db/db";
import { formatBytes } from "../../db/storage";
import { canSaveAllToFolder, saveAllToFolder } from "../export/saveToFolder";
import { saveFiles } from "../photos/savePhotos";
import { buildBackupFile, recordBackups } from "./backupActions";

type State =
  | { status: "idle" }
  | { status: "building"; done: number; total: number }
  | { status: "ready"; files: File[]; ids: string[] }
  | { status: "error"; message: string };

/**
 * Settings, Storage: one inspection file per inspection, shared together
 * (Save to Files, then a folder). Working copies of photos only; camera
 * originals are an option per inspection on Pre-inspection.
 */
export function BackupAll() {
  const inspections = useLiveQuery(() => db.inspections.toArray(), []);
  const [state, setState] = useState<State>({ status: "idle" });
  const [saved, setSaved] = useState<string | null>(null);
  if (!inspections) return null;
  const stale = inspections.filter(needsBackup).length;

  async function build() {
    setSaved(null);
    const ids = (inspections ?? []).map((i) => i.id);
    const files: File[] = [];
    try {
      for (const [i, id] of ids.entries()) {
        setState({ status: "building", done: i, total: ids.length });
        files.push(await buildBackupFile(id, false));
      }
      setState({ status: "ready", files, ids });
    } catch (e) {
      console.error("Backup failed", e);
      setState({
        status: "error",
        message: "The backup couldn't be made. Try again.",
      });
    }
  }

  async function share(files: File[], ids: string[]) {
    const result = await saveFiles(files);
    if (result !== "cancelled") {
      await recordBackups(ids);
      setState({ status: "idle" });
    }
  }

  /** On a PC: pick a folder and write every file into it. */
  async function saveToFolder(files: File[], ids: string[]) {
    try {
      const folder = await saveAllToFolder(files);
      if (!folder) return;
      await recordBackups(ids);
      setState({ status: "idle" });
      setSaved(
        `Saved ${files.length} ${files.length === 1 ? "file" : "files"} to ${folder}.`,
      );
    } catch (e) {
      console.error("Save to folder failed", e);
      setState({
        status: "error",
        message:
          "The files couldn't be saved there. Try another folder, or Back up all again.",
      });
    }
  }

  if (inspections.length === 0)
    return <p className="muted small">No inspections to back up yet.</p>;

  return (
    <div className="backup-all" data-testid="backup-all">
      <p className="muted small">
        {stale === 0
          ? "Every inspection is backed up."
          : `${stale} of ${inspections.length} inspections changed since their last backup.`}
      </p>
      {saved && (
        <p role="status" className="muted small">
          {saved}
        </p>
      )}
      {state.status === "error" && (
        <p role="alert" className="error">
          {state.message}
        </p>
      )}
      {state.status === "ready" ? (
        <p className="button-row">
          <button
            type="button"
            className="emphasis"
            onClick={() => void share(state.files, state.ids)}
          >
            Share {state.files.length} files…
          </button>
          {canSaveAllToFolder() && (
            <button
              type="button"
              onClick={() => void saveToFolder(state.files, state.ids)}
            >
              <FolderDown aria-hidden="true" /> Save to folder…
            </button>
          )}
          <span className="muted small">
            {formatBytes(state.files.reduce((n, f) => n + f.size, 0))}. Choose
            Save to Files, then a folder.
          </span>
        </p>
      ) : (
        <p className="button-row">
          <button
            type="button"
            className="primary"
            disabled={state.status === "building"}
            onClick={() => void build()}
          >
            <CloudUpload aria-hidden="true" />{" "}
            {state.status === "building"
              ? `Preparing ${state.done + 1} of ${state.total}…`
              : `Back up all (${inspections.length} ${inspections.length === 1 ? "inspection" : "inspections"})`}
          </button>
        </p>
      )}
    </div>
  );
}
