/**
 * The inspection file's data (SPEC section 9): everything one inspection
 * needs, gathered from the database, and put back on import. Zipping lives
 * in features/backup/inspectionFile.ts.
 */
import { deleteInspection } from "./inspections";
import { projectsWithJobNumber } from "./projects";
import type { InspectionDb } from "./schema";
import type {
  Drawing,
  Inspection,
  Item,
  Markup,
  Memo,
  ObservationBox,
  Photo,
  Project,
  Snippet,
  StoredBlob,
} from "./types";

/**
 * Bumped when the file's data changes shape; older files stay readable.
 * 2: markup (slice 2).
 */
export const SCHEMA_VERSION = 2;

export interface InspectionData {
  schemaVersion: number;
  /** The app build that wrote it, e.g. "0.1.0 (996b0c3)". */
  app: string;
  exportedAt: number;
  project: Project | null;
  inspection: Inspection;
  drawings: Drawing[];
  items: Item[];
  observationBoxes: ObservationBox[];
  /** Pen and highlighter marks (schemaVersion 2; absent in version 1 files). */
  markups?: Markup[];
  photos: Photo[];
  memo: Memo | null;
  /** Prefilled messages, so a memo's conditions and the notes box heading travel too. */
  snippets: Snippet[];
  /** Every stored file the records refer to (bytes go in the zip). */
  blobs: { id: string; type: string; size: number }[];
}

export interface CollectedInspection {
  data: InspectionData;
  blobs: StoredBlob[];
}

/**
 * One inspection with its project, drawings, pins, photos, memo and
 * snippets. Camera originals only with `includeOriginals` (otherwise the
 * photos are written as if their originals had been freed).
 */
export async function collectInspection(
  db: InspectionDb,
  inspectionId: string,
  options: { includeOriginals: boolean; app: string; now?: number },
): Promise<CollectedInspection> {
  const inspection = await db.inspections.get(inspectionId);
  if (!inspection) throw new Error(`Inspection ${inspectionId} not found`);
  const [project, drawings, items, memo, snippets, markups] = await Promise.all(
    [
      inspection.projectId ? db.projects.get(inspection.projectId) : undefined,
      db.drawings.where("inspectionId").equals(inspectionId).toArray(),
      db.items.where("inspectionId").equals(inspectionId).toArray(),
      db.memos.where("inspectionId").equals(inspectionId).first(),
      db.snippets.toArray(),
      db.markups.where("inspectionId").equals(inspectionId).toArray(),
    ],
  );
  const drawingIds = new Set(drawings.map((d) => d.id));
  const boxes = await db.observationBoxes
    .filter((b) => drawingIds.has(b.drawingId))
    .toArray();
  const photos = (
    await db.photos.bulkGet([
      ...items.flatMap((item) => item.photoIds),
      ...(inspection.photoIds ?? []),
    ])
  )
    .filter((p) => p !== undefined)
    .map((p) => {
      if (options.includeOriginals || !p.originalBlobId) return p;
      const rest = { ...p };
      delete rest.originalBlobId;
      delete rest.originalSize;
      return rest;
    });
  const blobIds = [
    ...drawings.map((d) => d.pdfBlobId),
    ...photos.flatMap((p) =>
      p.originalBlobId ? [p.blobId, p.originalBlobId] : [p.blobId],
    ),
    ...(memo?.signatureBlobId ? [memo.signatureBlobId] : []),
  ];
  const blobs = (await db.blobs.bulkGet(blobIds)).filter(
    (b) => b !== undefined,
  );
  if (blobs.length !== blobIds.length)
    throw new Error("Some of this inspection's files are missing");
  return {
    data: {
      schemaVersion: SCHEMA_VERSION,
      app: options.app,
      exportedAt: options.now ?? Date.now(),
      project: project ?? null,
      inspection,
      drawings,
      items,
      observationBoxes: boxes,
      markups,
      photos,
      memo: memo ?? null,
      snippets,
      blobs: blobs.map((b) => ({ id: b.id, type: b.type, size: b.size })),
    },
    blobs,
  };
}

/** Records the backup time (without counting as an edit). */
export async function markBackedUp(
  db: InspectionDb,
  inspectionId: string,
  at = Date.now(),
): Promise<void> {
  await db.inspections.update(inspectionId, { backedUpAt: at });
}

/** Whether an inspection changed since its last backup (or never had one). */
export function needsBackup(
  inspection: Pick<Inspection, "updatedAt" | "backedUpAt">,
): boolean {
  return !inspection.backedUpAt || inspection.updatedAt > inspection.backedUpAt;
}

/**
 * How an import treats an inspection already on the device: "replace" it,
 * or "keepBoth" (the file's copy gets new ids). "new" when it isn't here.
 */
export type ImportMode = "new" | "replace" | "keepBoth";

/** Gives every record in the file new ids (Keep both). */
function withNewIds(data: InspectionData): InspectionData {
  const ids = new Map<string, string>();
  const id = (old: string) => {
    let next = ids.get(old);
    if (!next) ids.set(old, (next = crypto.randomUUID()));
    return next;
  };
  const maybe = (old: string | null | undefined) => (old ? id(old) : old);
  return {
    ...data,
    inspection: {
      ...data.inspection,
      id: id(data.inspection.id),
      photoIds: data.inspection.photoIds.map(id),
    },
    drawings: data.drawings.map((d) => ({
      ...d,
      id: id(d.id),
      inspectionId: id(d.inspectionId),
      pdfBlobId: id(d.pdfBlobId),
      // Pages moved in from another drawing name it.
      pages: d.pages?.map((p) => (p.from ? { ...p, from: id(p.from) } : p)),
    })),
    items: data.items.map((item) => ({
      ...item,
      id: id(item.id),
      inspectionId: id(item.inspectionId),
      drawingId: maybe(item.drawingId) ?? "",
      photoIds: item.photoIds.map(id),
      copies: item.copies?.map((c) => ({ ...c, drawingId: id(c.drawingId) })),
    })),
    observationBoxes: data.observationBoxes.map((b) => ({
      ...b,
      id: id(b.id),
      drawingId: id(b.drawingId),
    })),
    markups: data.markups?.map((m) => ({
      ...m,
      id: id(m.id),
      inspectionId: id(m.inspectionId),
      drawingId: id(m.drawingId),
    })),
    photos: data.photos.map((p) => ({
      ...p,
      id: id(p.id),
      blobId: id(p.blobId),
      originalBlobId: maybe(p.originalBlobId) ?? undefined,
    })),
    memo: data.memo && {
      ...data.memo,
      id: id(data.memo.id),
      inspectionId: id(data.memo.inspectionId),
      signatureBlobId: maybe(data.memo.signatureBlobId) ?? null,
      // Item ids changed: rewordings and the export record follow them.
      itemOverrides: Object.fromEntries(
        Object.entries(data.memo.itemOverrides).map(([k, v]) => [id(k), v]),
      ),
      exportedLetters:
        data.memo.exportedLetters &&
        Object.fromEntries(
          Object.entries(data.memo.exportedLetters).map(([k, v]) => [id(k), v]),
        ),
    },
    blobs: data.blobs.map((b) => ({ ...b, id: id(b.id) })),
    // Snippets are shared across inspections: they keep their ids.
    snippets: data.snippets,
    project: data.project,
  };
}

/** "SIM007", "SSI007" or "SIM-007" -> 7 (0 when it isn't in that form). */
function simNumber(reference: string): number {
  const match = /^[A-Z]{1,6}-?(\d+)$/i.exec(reference.trim());
  return match ? Number(match[1]) : 0;
}

/**
 * Puts an inspection file's data on the device. Its project joins one
 * already here (same id, else the same job number), keeping the device's
 * project details; otherwise the file's project is added. Snippets not
 * here are added; the memo counter moves up so SIM references are never
 * reused. Returns the imported inspection's id.
 */
export async function importInspection(
  db: InspectionDb,
  file: InspectionData,
  blobs: Map<string, Uint8Array>,
  mode: ImportMode,
): Promise<string> {
  // Blob bytes are keyed by the file's ids; remember them before renaming.
  const blobOrder = file.blobs.map((b) => b.id);
  const missing = blobOrder.filter((id) => !blobs.has(id));
  if (missing.length)
    throw new Error(`The file is missing ${missing.length} stored file(s)`);
  const data = mode === "keepBoth" ? withNewIds(file) : file;
  return db.transaction(
    "rw",
    [
      db.projects,
      db.inspections,
      db.drawings,
      db.items,
      db.photos,
      db.blobs,
      db.observationBoxes,
      db.markups,
      db.memos,
      db.memoCounters,
      db.snippets,
    ],
    async () => {
      // In the same transaction: a failed import leaves the old copy alone.
      if (mode === "replace") await deleteInspection(db, file.inspection.id);
      let projectId: string | null = null;
      let jobNumber = "";
      if (data.project) {
        const sameId = await db.projects.get(data.project.id);
        const sameJob = sameId
          ? []
          : await projectsWithJobNumber(db, data.project.jobNumber);
        const project = sameId ?? sameJob[0] ?? null;
        if (project) {
          projectId = project.id;
          jobNumber = project.jobNumber;
        } else {
          await db.projects.add(data.project);
          projectId = data.project.id;
          jobNumber = data.project.jobNumber;
        }
      }
      await db.blobs.bulkPut(
        data.blobs.map((meta, i) => {
          const bytes = blobs.get(blobOrder[i])!;
          return {
            id: meta.id,
            type: meta.type,
            size: bytes.byteLength,
            data: bytes.slice().buffer,
          };
        }),
      );
      // It came from a file, so it counts as backed up until edited.
      await db.inspections.put({
        ...data.inspection,
        projectId,
        backedUpAt: Math.max(data.exportedAt, data.inspection.updatedAt),
      });
      await db.drawings.bulkPut(data.drawings);
      await db.items.bulkPut(data.items);
      await db.photos.bulkPut(data.photos);
      await db.observationBoxes.bulkPut(data.observationBoxes);
      await db.markups.bulkPut(data.markups ?? []);
      if (data.memo) {
        await db.memos.put(data.memo);
        const seq = simNumber(data.memo.reference);
        const key = jobNumber.trim();
        if (key && seq) {
          const counter = await db.memoCounters.get(key);
          if ((counter?.lastSeq ?? 0) < seq)
            await db.memoCounters.put({ jobNumber: key, lastSeq: seq });
        }
      }
      const known = new Set(
        (await db.snippets.toCollection().primaryKeys()) as string[],
      );
      await db.snippets.bulkAdd(data.snippets.filter((s) => !known.has(s.id)));
      return data.inspection.id;
    },
  );
}
