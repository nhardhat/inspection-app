/**
 * Saving photos to the iPad for filing (SPEC section 6). A web app can only
 * do this through the Share sheet (Save Images / Save to Files), and only
 * straight after a tap, so files are prepared first and shared on the next
 * tap. Camera shots are shared at native resolution (their kept original);
 * other photos as the working copy.
 */
import { db } from "../../db/db";
import type { InspectionPhoto } from "../../db/photos";
import { kindName } from "../items/letters";

/** Photos per Share sheet; more at once can run an iPad out of memory. */
export const SAVE_BATCH = 20;

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/heif": "heif",
};

/** e.g. "SY000001 Instruction A 1.jpg" or "SY000001 General 2.jpg", safe for Files. */
export function photoFileName(
  jobNumber: string,
  entry: Pick<InspectionPhoto, "item" | "number">,
  type: string,
): string {
  const ext = EXTENSIONS[type] ?? "jpg";
  const name = [
    jobNumber.trim(),
    entry.item
      ? `${kindName(entry.item.kind)} ${entry.item.letter}`
      : "General",
    String(entry.number),
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/[\\/:*?"<>|]+/g, "-");
  return `${name}.${ext}`;
}

/** Splits photos into Share-sheet-sized batches. */
export function batches<T>(list: T[], size = SAVE_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Loads a batch as named files: the original where kept, else the working copy. */
export async function prepareFiles(
  entries: InspectionPhoto[],
  jobNumber: string,
): Promise<File[]> {
  const files: File[] = [];
  for (const entry of entries) {
    const stored = await db.blobs.get(
      entry.photo.originalBlobId ?? entry.photo.blobId,
    );
    if (!stored) continue;
    files.push(
      new File([stored.data], photoFileName(jobNumber, entry, stored.type), {
        type: stored.type,
        lastModified: entry.photo.takenAt,
      }),
    );
  }
  return files;
}

export type SaveResult = "shared" | "downloaded" | "cancelled";

/**
 * Opens the Share sheet with the files (call straight from a tap). On a
 * computer without touch, or where sharing files isn't supported or fails
 * (Chrome and Edge on Windows can reject silently; engineer, 2026-10-23),
 * downloads them.
 */
export async function saveFiles(files: File[]): Promise<SaveResult> {
  if (navigator.maxTouchPoints > 0 && navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files });
      return "shared";
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return "cancelled";
      console.warn("Share failed; downloading instead", e);
    }
  }
  for (const file of files) {
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  return "downloaded";
}
