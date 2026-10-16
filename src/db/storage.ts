import type { InspectionDb } from "./schema";
import { SETTINGS_ID } from "./types";

/**
 * Asks the browser to keep our data from eviction (SPEC section 10). Runs
 * once; the result is stored in settings. Call after ensureSeeded().
 */
export async function requestPersistentStorageOnce(
  db: InspectionDb,
  storage: StorageManager | undefined = navigator.storage,
): Promise<void> {
  const settings = await db.settings.get(SETTINGS_ID);
  if (!settings || settings.persistRequested) return;
  if (!storage?.persist) return;

  const granted = await storage.persist();
  await db.settings.update(SETTINGS_ID, {
    persistRequested: { granted, at: Date.now() },
  });
}

export interface StorageStatus {
  /** Bytes used, if the browser reports it. */
  usage?: number;
  /** Bytes available to this site, if the browser reports it. */
  quota?: number;
  /** Whether storage is currently persistent, if the browser reports it. */
  persisted?: boolean;
}

export async function getStorageStatus(
  storage: StorageManager | undefined = navigator.storage,
): Promise<StorageStatus> {
  const [estimate, persisted] = await Promise.all([
    storage?.estimate?.().catch(() => undefined),
    storage?.persisted?.().catch(() => undefined),
  ]);
  return { usage: estimate?.usage, quota: estimate?.quota, persisted };
}

/**
 * Whether saving failed because the app's storage on the device is full
 * (step 10d): IndexedDB's QuotaExceededError, as Dexie reports it (the
 * browser's error may be inside).
 */
export function isStorageFull(error: unknown): boolean {
  let e: unknown = error;
  for (let depth = 0; e && depth < 5; depth++) {
    const { name, inner, cause } = e as {
      name?: string;
      inner?: unknown;
      cause?: unknown;
    };
    if (name === "QuotaExceededError") return true;
    e = inner ?? cause;
  }
  return false;
}

/** What to tell the engineer when storage is full. */
export const STORAGE_FULL_MESSAGE =
  "There isn't enough space on this iPad to save it. Back up and delete inspections you've finished (Settings, Storage and backup), then try again.";

/** Storage this full or more (0..1) gets a warning on the Dashboard. */
export const NEARLY_FULL = 0.8;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}
