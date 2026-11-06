import { useEffect, useRef, useState } from "react";
import { db } from "../../db/db";
import { markPhotosSaved, type InspectionPhoto } from "../../db/photos";
import { batches, prepareFiles, saveFiles } from "./savePhotos";

interface Props {
  entries: InspectionPhoto[];
  jobNumber: string;
  onClose: () => void;
}

/**
 * Saves photos to the iPad through the Share sheet, in batches of 20. Each
 * batch is loaded first, so the Share sheet opens straight from the tap
 * (iPadOS refuses it otherwise).
 */
export function SavePhotosDialog({ entries, jobNumber, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  // Fixed when the dialog opens, so batches don't shift while saving.
  const [groups] = useState(() => batches(entries));
  const [index, setIndex] = useState(0);
  const [files, setFiles] = useState<File[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const done = index >= groups.length;
  const batch = groups[index];

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  // Load the current batch, ready for the next tap.
  useEffect(() => {
    if (!batch) return;
    let current = true;
    void prepareFiles(batch, jobNumber).then(
      (prepared) => current && setFiles(prepared),
      (e: unknown) => {
        console.error("Preparing photos failed", e);
        if (current) setError("Couldn't load the photos. Try again.");
      },
    );
    return () => {
      current = false;
      setFiles(null);
    };
  }, [batch, jobNumber]);

  async function save() {
    if (!files || !batch) return;
    setError(null);
    setSaving(true);
    try {
      const result = await saveFiles(files);
      if (result !== "cancelled") {
        await markPhotosSaved(
          db,
          batch.map((e) => e.photo.id),
        );
        setIndex((i) => i + 1);
      }
    } catch (e) {
      console.error("Saving photos failed", e);
      setError("The photos couldn't be shared. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const first = index * (groups[0]?.length ?? 0) + 1;
  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      aria-labelledby="save-photos-title"
      data-testid="save-photos-dialog"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <h2 id="save-photos-title">Save photos to device</h2>
      {done ? (
        <p role="status">
          {entries.length === 1
            ? "The photo has been saved."
            : `All ${entries.length} photos have been saved.`}
        </p>
      ) : (
        <>
          {groups.length > 1 && (
            <p>
              Batch {index + 1} of {groups.length}: photos {first}–
              {first + batch.length - 1} of {entries.length}.
            </p>
          )}
          <p className="muted">
            In the Share sheet, choose <strong>Save Images</strong> (Photos) or{" "}
            <strong>Save to Files</strong>. Camera shots are saved at full size.
          </p>
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <p className="button-row dialog-actions">
        <button type="button" onClick={onClose}>
          {done ? "Done" : "Close"}
        </button>
        {!done && (
          <button
            type="button"
            className="primary"
            disabled={!files || saving}
            onClick={() => void save()}
          >
            {files
              ? `Save ${batch.length === 1 ? "1 photo" : `${batch.length} photos`}`
              : "Preparing…"}
          </button>
        )}
      </p>
    </dialog>
  );
}
