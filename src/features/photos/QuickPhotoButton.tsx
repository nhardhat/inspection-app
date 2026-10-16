import { Camera } from "lucide-react";
import { STORAGE_FULL_MESSAGE, isStorageFull } from "../../db/storage";
import { useRef, useState } from "react";
import { db } from "../../db/db";
import { addPhotos, type NewPhoto } from "../../db/photos";
import { processPhoto } from "./processPhoto";

/**
 * Drawings toolbar: take a general photo (e.g. an overall view) without
 * leaving the drawing. It joins the General photos on the Site memo step.
 */
export function QuickPhotoButton({ inspectionId }: { inspectionId: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function add(files: File[]) {
    setStatus("Adding photo…");
    try {
      const photos: NewPhoto[] = [];
      // One at a time, to stay within iPad memory.
      for (const file of files) photos.push(await processPhoto(file, "camera"));
      await addPhotos(db, { inspectionId }, photos);
      setStatus(
        photos.length === 1
          ? "Photo added to General photos"
          : `${photos.length} photos added to General photos`,
      );
    } catch (e) {
      console.error("Could not add photo", e);
      if (isStorageFull(e)) {
        // Long enough to read.
        setStatus(STORAGE_FULL_MESSAGE);
        window.setTimeout(() => setStatus(null), 10_000);
        return;
      }
      setStatus("That photo couldn't be added.");
    }
    window.setTimeout(() => setStatus(null), 3000);
  }

  return (
    <>
      <button
        type="button"
        className="icon-button quiet"
        aria-label="Take a general photo"
        title="Take a general photo"
        onClick={() => input.current?.click()}
      >
        <Camera aria-hidden="true" />
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        data-testid="quick-photo-input"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) void add(files);
        }}
      />
      {status && (
        <span className="toolbar-toast" role="status">
          {status}
        </span>
      )}
    </>
  );
}
