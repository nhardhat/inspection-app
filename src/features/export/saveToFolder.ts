/**
 * Save to folder (engineer, 2026-11-05): on a PC (Chrome or Edge) an export
 * can be saved straight into a job folder through the system's Save As box,
 * instead of sharing or downloading it. Safari on the iPad has no Save As
 * box for web apps, so there the Share sheet stays the way out.
 */

interface SaveFilePickerOptions {
  suggestedName?: string;
  /** The picker opens in the folder last used with this id. */
  id?: string;
  startIn?: "documents" | "downloads" | "desktop";
  types?: { description: string; accept: Record<string, string[]> }[];
}

interface WritableFileStream {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}

interface SaveFileHandle {
  name: string;
  createWritable(): Promise<WritableFileStream>;
}

interface FolderHandle {
  name: string;
  getFileHandle(
    name: string,
    options: { create: boolean },
  ): Promise<SaveFileHandle>;
}

type WithPicker = Window & {
  showSaveFilePicker?: (
    options: SaveFilePickerOptions,
  ) => Promise<SaveFileHandle>;
  showDirectoryPicker?: (options: {
    id?: string;
    mode?: "read" | "readwrite";
    startIn?: "documents" | "downloads" | "desktop";
  }) => Promise<FolderHandle>;
};

/** The folder the Save As box remembers for exports (PDF, Word, register). */
export const EXPORTS_FOLDER = "hardhat-exports";
/** A separate remembered folder for backups (engineer, 2026-11-05). */
export const BACKUPS_FOLDER = "hardhat-backups";

/** Whether this browser can show a Save As box (Chrome and Edge on a computer). */
export function canSaveToFolder(): boolean {
  return typeof (window as WithPicker).showSaveFilePicker === "function";
}

/** Whether this browser can pick a folder to save several files into. */
export function canSaveAllToFolder(): boolean {
  return typeof (window as WithPicker).showDirectoryPicker === "function";
}

/** The file's extension, with a dot ("" if none). */
function extension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot) : "";
}

/**
 * Opens the Save As box for `file` (call straight from a click) and writes
 * it where the engineer chose. Returns the saved name, or null if cancelled.
 */
export async function saveToFolder(
  file: File,
  folderId = EXPORTS_FOLDER,
): Promise<string | null> {
  const picker = (window as WithPicker).showSaveFilePicker;
  if (!picker) throw new Error("Save As isn't available in this browser");
  const ext = extension(file.name);
  let handle: SaveFileHandle;
  try {
    handle = await picker.call(window, {
      suggestedName: file.name,
      // The box opens in the folder last used with this id.
      id: folderId,
      startIn: "documents",
      types:
        ext && file.type
          ? [
              {
                description: ext.slice(1).toUpperCase(),
                accept: { [file.type]: [ext] },
              },
            ]
          : undefined,
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") return null;
    throw e;
  }
  const out = await handle.createWritable();
  await out.write(file);
  await out.close();
  return handle.name;
}

/**
 * Asks for a folder (call straight from a click) and writes every file into
 * it, replacing files of the same name. Returns the folder's name, or null
 * if cancelled.
 */
export async function saveAllToFolder(
  files: File[],
  folderId = BACKUPS_FOLDER,
): Promise<string | null> {
  const picker = (window as WithPicker).showDirectoryPicker;
  if (!picker)
    throw new Error("Folder picking isn't available in this browser");
  let folder: FolderHandle;
  try {
    folder = await picker.call(window, {
      id: folderId,
      mode: "readwrite",
      startIn: "documents",
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") return null;
    throw e;
  }
  for (const file of files) {
    const handle = await folder.getFileHandle(file.name, { create: true });
    const out = await handle.createWritable();
    await out.write(file);
    await out.close();
  }
  return folder.name;
}
