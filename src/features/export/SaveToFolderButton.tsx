import { FolderDown } from "lucide-react";
import { useState } from "react";
import { canSaveToFolder, EXPORTS_FOLDER, saveToFolder } from "./saveToFolder";

/**
 * "Save to folder…" beside Share, on a PC only (engineer, 2026-11-05):
 * the system's Save As box, opening in the folder last used with `folderId`.
 * `onSaved` runs once the file is written (e.g. to mark a backup done).
 */
export function SaveToFolderButton({
  file,
  folderId = EXPORTS_FOLDER,
  onSaved,
}: {
  file: File;
  folderId?: string;
  onSaved?: () => void | Promise<void>;
}) {
  const [status, setStatus] = useState<
    { saved: string } | { failed: true } | null
  >(null);
  if (!canSaveToFolder()) return null;

  async function save() {
    setStatus(null);
    try {
      const saved = await saveToFolder(file, folderId);
      if (saved) {
        setStatus({ saved });
        await onSaved?.();
      }
    } catch (e) {
      console.error("Save to folder failed", e);
      setStatus({ failed: true });
    }
  }

  return (
    <>
      <button type="button" onClick={() => void save()}>
        <FolderDown aria-hidden="true" /> Save to folder…
      </button>
      {status && (
        <p
          role="status"
          className={`save-status ${"failed" in status ? "error" : "muted"}`}
        >
          {"failed" in status
            ? "The file couldn't be saved there. Try another folder, or Share."
            : `Saved ${status.saved}.`}
        </p>
      )}
    </>
  );
}
