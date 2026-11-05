import { FolderDown } from "lucide-react";
import { useState } from "react";
import { canSaveToFolder, saveToFolder } from "./saveToFolder";

/**
 * "Save to folder…" beside Share, on a PC only (engineer, 2026-11-05):
 * the system's Save As box, opening in the folder last used.
 */
export function SaveToFolderButton({ file }: { file: File }) {
  const [status, setStatus] = useState<
    { saved: string } | { failed: true } | null
  >(null);
  if (!canSaveToFolder()) return null;

  async function save() {
    setStatus(null);
    try {
      const saved = await saveToFolder(file);
      if (saved) setStatus({ saved });
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
