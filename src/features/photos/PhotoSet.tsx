import { useLiveQuery } from "dexie-react-hooks";
import { STORAGE_FULL_MESSAGE, isStorageFull } from "../../db/storage";
import { Camera, Images, Share } from "lucide-react";
import { useRef, useState } from "react";
import { db } from "../../db/db";
import { loadJobInspection } from "../../db/projects";
import { ConfirmDialog } from "../../app/ConfirmDialog";
import type { NewPhoto } from "../../db/photos";
import type { Item, Photo } from "../../db/types";
import { PhotoViewer } from "./PhotoViewer";
import { processPhoto } from "./processPhoto";
import { SavePhotosDialog } from "./SavePhotosDialog";
import { useBlobUrl } from "./useBlobUrl";

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

interface Props {
  photoIds: string[];
  inspectionId: string;
  /** The photos' item, or null for general photos (used to name saved files). */
  item: Item | null;
  /** e.g. "Instruction A" or "General". */
  title: string;
  /** Heading, e.g. "Photos". */
  label: string;
  onAdd: (photos: NewPhoto[]) => Promise<void>;
  onDelete: (photo: Photo) => void;
  /** Ask before deleting (where there's no Undo button). */
  confirmDelete?: boolean;
}

/**
 * A set of photos (an item's, or the inspection's general photos): Take
 * photo (camera, original kept for saving at full size), Choose photos
 * (library, several at once), Save to iPad, and thumbnails that open full
 * screen.
 */
export function PhotoSet({
  photoIds,
  inspectionId,
  item,
  title,
  label,
  onAdd,
  onDelete,
  confirmDelete = false,
}: Props) {
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Photo | null>(null);
  const jobNumber =
    useLiveQuery(
      async () => (await loadJobInspection(db, inspectionId))?.jobNumber,
      [inspectionId],
    ) ?? "";
  const photos =
    useLiveQuery(
      async () =>
        (await db.photos.bulkGet(photoIds)).filter(
          (p): p is Photo => p !== undefined,
        ),
      [photoIds.join(",")],
    ) ?? [];

  function remove(photo: Photo) {
    onDelete(photo);
    setViewing((v) =>
      v === null || photos.length <= 1 ? null : Math.min(v, photos.length - 2),
    );
  }

  async function add(files: File[], source: Photo["source"]) {
    setError(null);
    setStatus(`Adding ${plural(files.length, "photo")}…`);
    const processed = [];
    let failed = 0;
    // One at a time: decoding several large photos at once can run an
    // iPad out of memory.
    for (const file of files) {
      try {
        processed.push(await processPhoto(file, source));
      } catch (e) {
        console.error("Photo import failed", e);
        failed++;
      }
    }
    try {
      if (processed.length) await onAdd(processed);
    } catch (e) {
      console.error("Saving photos failed", e);
      if (isStorageFull(e)) {
        setStatus(null);
        return setError(STORAGE_FULL_MESSAGE);
      }
      failed = files.length;
    }
    setStatus(null);
    if (failed)
      setError(
        `${plural(failed, "photo")} couldn't be added. Try again, or choose a different photo.`,
      );
  }

  const onFiles =
    (source: Photo["source"]) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = [...(e.target.files ?? [])];
      e.target.value = "";
      if (files.length) void add(files, source);
    };

  return (
    <div className="item-photos" role="group" aria-label={label}>
      <span className="item-photos-label">
        {label}
        {photos.length ? ` (${photos.length})` : ""}
      </span>
      <div className="item-photos-buttons">
        <button
          type="button"
          disabled={status !== null}
          onClick={() => camera.current?.click()}
        >
          <Camera aria-hidden="true" /> Take photo
        </button>
        <button
          type="button"
          disabled={status !== null}
          onClick={() => library.current?.click()}
        >
          <Images aria-hidden="true" /> Choose photos
        </button>
        {photos.length > 0 && (
          <button
            type="button"
            className="quiet"
            onClick={() => setSaving(true)}
          >
            <Share aria-hidden="true" /> Save to iPad
          </button>
        )}
      </div>
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        data-testid="photo-camera-input"
        onChange={onFiles("camera")}
      />
      <input
        ref={library}
        type="file"
        accept="image/*"
        multiple
        hidden
        data-testid="photo-library-input"
        onChange={onFiles("library")}
      />
      {status && (
        <p role="status" data-testid="photos-status">
          {status}
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {photos.length > 0 && (
        <ul className="photo-grid" aria-label={`${title} photos`}>
          {photos.map((photo, i) => (
            <li key={photo.id}>
              <Thumb
                photo={photo}
                label={`${title} photo ${i + 1}`}
                onOpen={() => setViewing(i)}
              />
            </li>
          ))}
        </ul>
      )}
      {saving && (
        <SavePhotosDialog
          entries={photos.map((photo, i) => ({ item, photo, number: i + 1 }))}
          jobNumber={jobNumber}
          onClose={() => setSaving(false)}
        />
      )}
      {viewing !== null && photos[viewing] && (
        <PhotoViewer
          photos={photos}
          index={viewing}
          inspectionId={inspectionId}
          title={title}
          onIndex={setViewing}
          onClose={() => setViewing(null)}
          onDelete={(photo) =>
            confirmDelete ? setDeleting(photo) : remove(photo)
          }
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        title="Delete this photo?"
        confirmLabel="Delete"
        danger
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) remove(deleting);
          setDeleting(null);
        }}
      >
        <p>It will be removed from the inspection and the report.</p>
      </ConfirmDialog>
    </div>
  );
}

function Thumb({
  photo,
  label,
  onOpen,
}: {
  photo: Photo;
  label: string;
  onOpen: () => void;
}) {
  const url = useBlobUrl(photo.blobId);
  return (
    <button
      type="button"
      className="photo-thumb"
      aria-label={`Open ${label}`}
      data-testid="photo-thumb"
      onClick={onOpen}
    >
      {url && <img src={url} alt="" />}
    </button>
  );
}
