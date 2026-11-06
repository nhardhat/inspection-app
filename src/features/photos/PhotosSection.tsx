import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { ConfirmDialog } from "../../app/ConfirmDialog";
import { db } from "../../db/db";
import {
  addPhotos,
  deletePhoto,
  listInspectionPhotos,
  removeOriginals,
} from "../../db/photos";
import { Images } from "lucide-react";
import { indexForLetter } from "../items/letters";
import { ItemPhotos } from "./ItemPhotos";
import { PhotoSet } from "./PhotoSet";
import { SavePhotosDialog } from "./SavePhotosDialog";

function megabytes(bytes: number) {
  return `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`;
}

/**
 * Site memo step: every photo, grouped as the appendix will be
 * (instructions, observations, then General photos, which aren't tied to
 * a pin); then save them all to the iPad (camera shots at full size) and
 * free the space the full-size copies take.
 */
export function PhotosSection({
  inspectionId,
  jobNumber,
}: {
  inspectionId: string;
  jobNumber: string;
}) {
  const entries = useLiveQuery(
    () => listInspectionPhotos(db, inspectionId),
    [inspectionId],
  );
  const generalIds = useLiveQuery(
    async () => (await db.inspections.get(inspectionId))?.photoIds ?? [],
    [inspectionId],
  );
  const items = useLiveQuery(async () => {
    const all = await db.items
      .where("inspectionId")
      .equals(inspectionId)
      .toArray();
    // Appendix order: instructions A, B…, then observations A, B….
    return all
      .filter((i) => i.photoIds.length > 0)
      .sort(
        (a, b) =>
          (a.kind === b.kind ? 0 : a.kind === "instruction" ? -1 : 1) ||
          indexForLetter(a.letter) - indexForLetter(b.letter),
      );
  }, [inspectionId]);
  const [saving, setSaving] = useState(false);
  const [confirmFree, setConfirmFree] = useState(false);
  const [freed, setFreed] = useState<string | null>(null);
  if (!entries || !generalIds || !items) return null;

  const originals = entries.filter((e) => e.photo.originalBlobId);
  const originalBytes = originals.reduce(
    (sum, e) => sum + (e.photo.originalSize ?? 0),
    0,
  );
  const freeable = originals.filter((e) => e.photo.savedAt);
  const freeableBytes = freeable.reduce(
    (sum, e) => sum + (e.photo.originalSize ?? 0),
    0,
  );

  return (
    <div className="card page-section" aria-labelledby="photos-heading">
      <h2 id="photos-heading" className="section-title">
        <Images aria-hidden="true" /> Photos
      </h2>
      <p className="muted">
        As they&rsquo;ll appear in the photo appendix. Add photos for an item
        from its pin, or take general photos (e.g. overall views) here or with
        the camera button above the drawings.
      </p>
      {items.map((item) => (
        <div key={item.id} className="photo-group">
          <ItemPhotos item={item} heading confirmDelete />
        </div>
      ))}
      <PhotoSet
        photoIds={generalIds}
        inspectionId={inspectionId}
        item={null}
        title="General"
        label="General photos"
        onAdd={async (photos) => {
          await addPhotos(db, { inspectionId }, photos);
        }}
        onDelete={(photo) => void deletePhoto(db, { inspectionId }, photo.id)}
        confirmDelete
      />
      {entries.length > 0 && (
        <>
          <p data-testid="photos-summary">
            {entries.length === 1 ? "1 photo" : `${entries.length} photos`}
            {originals.length > 0 &&
              ` · ${originals.length} full-size camera ${originals.length === 1 ? "copy" : "copies"} kept (${megabytes(originalBytes)})`}
          </p>
          <p className="button-row">
            <button
              type="button"
              className="primary"
              onClick={() => setSaving(true)}
            >
              Save photos to device
            </button>
            <button
              type="button"
              disabled={freeable.length === 0}
              onClick={() => setConfirmFree(true)}
            >
              Free up space
            </button>
          </p>
          {freed && (
            <p role="status" className="muted">
              {freed}
            </p>
          )}
        </>
      )}
      {saving && (
        <SavePhotosDialog
          entries={entries}
          jobNumber={jobNumber}
          onClose={() => setSaving(false)}
        />
      )}
      <ConfirmDialog
        open={confirmFree}
        title="Free up space?"
        confirmLabel="Free up space"
        onCancel={() => setConfirmFree(false)}
        onConfirm={() => {
          setConfirmFree(false);
          void removeOriginals(
            db,
            freeable.map((e) => e.photo.id),
          ).then((bytes) => setFreed(`Freed ${megabytes(bytes)}.`));
        }}
      >
        <p>
          This removes the full-size copies of {freeable.length} photo
          {freeable.length === 1 ? "" : "s"} already saved to the device (
          {megabytes(freeableBytes)}). The smaller copies stay for the report.
          Photos you saved to the device are not affected.
        </p>
      </ConfirmDialog>
    </div>
  );
}
