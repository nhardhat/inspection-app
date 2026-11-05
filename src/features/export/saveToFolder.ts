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

type WithPicker = Window & {
  showSaveFilePicker?: (
    options: SaveFilePickerOptions,
  ) => Promise<SaveFileHandle>;
};

/** Whether this browser can show a Save As box (Chrome and Edge on a computer). */
export function canSaveToFolder(): boolean {
  return typeof (window as WithPicker).showSaveFilePicker === "function";
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
export async function saveToFolder(file: File): Promise<string | null> {
  const picker = (window as WithPicker).showSaveFilePicker;
  if (!picker) throw new Error("Save As isn't available in this browser");
  const ext = extension(file.name);
  let handle: SaveFileHandle;
  try {
    handle = await picker.call(window, {
      suggestedName: file.name,
      // One remembered folder for all exports: usually the job's folder.
      id: "hardhat-exports",
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
