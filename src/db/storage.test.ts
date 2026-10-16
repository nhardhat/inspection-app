import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { InspectionDb } from "./schema";
import { ensureSeeded } from "./seed";
import {
  formatBytes,
  getStorageStatus,
  isStorageFull,
  requestPersistentStorageOnce,
} from "./storage";
import { SETTINGS_ID } from "./types";

let db: InspectionDb;

beforeEach(async () => {
  db = new InspectionDb(`test-${crypto.randomUUID()}`);
  await ensureSeeded(db);
});

afterEach(async () => {
  await db.delete();
});

function fakeStorage(granted: boolean) {
  return {
    persist: vi.fn().mockResolvedValue(granted),
    persisted: vi.fn().mockResolvedValue(granted),
    estimate: vi.fn().mockResolvedValue({ usage: 2048, quota: 1024 ** 3 }),
  } as unknown as StorageManager;
}

describe("requestPersistentStorageOnce", () => {
  test("asks once and records the result", async () => {
    const storage = fakeStorage(true);

    await requestPersistentStorageOnce(db, storage);
    await requestPersistentStorageOnce(db, storage);

    expect(storage.persist).toHaveBeenCalledTimes(1);
    const settings = await db.settings.get(SETTINGS_ID);
    expect(settings?.persistRequested?.granted).toBe(true);
  });

  test("does nothing when the browser has no storage API", async () => {
    await requestPersistentStorageOnce(db, undefined);

    const settings = await db.settings.get(SETTINGS_ID);
    expect(settings?.persistRequested).toBeUndefined();
  });
});

describe("getStorageStatus", () => {
  test("reports usage, quota and persistence", async () => {
    expect(await getStorageStatus(fakeStorage(false))).toEqual({
      usage: 2048,
      quota: 1024 ** 3,
      persisted: false,
    });
  });

  test("returns unknowns when the API is missing", async () => {
    expect(await getStorageStatus(undefined)).toEqual({
      usage: undefined,
      quota: undefined,
      persisted: undefined,
    });
  });
});

test("formatBytes", () => {
  expect(formatBytes(512)).toBe("512 B");
  expect(formatBytes(2048)).toBe("2.0 KB");
  expect(formatBytes(150 * 1024 ** 2)).toBe("150 MB");
  expect(formatBytes(1024 ** 3)).toBe("1.0 GB");
});

describe("isStorageFull", () => {
  test("knows the quota error, also inside Dexie's", () => {
    const quota = new DOMException("full", "QuotaExceededError");
    expect(isStorageFull(quota)).toBe(true);
    expect(isStorageFull({ name: "AbortError", inner: quota })).toBe(true);
    expect(isStorageFull(new Error("not a PDF"))).toBe(false);
    expect(isStorageFull(undefined)).toBe(false);
  });
});
