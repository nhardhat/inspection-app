/**
 * Inspection types (engineer, 2026-10-20; feedback round 1, item 4):
 * General concrete, steel, piling… (inspectionType snippets, edited in
 * Settings). Picking one adds each line of its text as a general note;
 * removing it removes those notes, asking first if any was edited since.
 */
import {
  createGeneralNote,
  deleteItemRecords,
  reletterInspection,
  touchInspection,
} from "./items";
import type { InspectionDb } from "./schema";
import type { Item, Snippet } from "./types";

/** A type's notes: each non-empty line of its text. */
export function typeNotes(snippet: Pick<Snippet, "text">): string[] {
  return snippet.text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** The general notes a type added that are still there. */
export async function notesFromType(
  db: InspectionDb,
  inspectionId: string,
  snippetId: string,
): Promise<Item[]> {
  return db.items
    .where("inspectionId")
    .equals(inspectionId)
    .filter((item) => item.fromType?.snippetId === snippetId)
    .toArray();
}

/** Whether a note was changed since its type added it. */
export const editedSinceAdded = (item: Item) =>
  item.fromType !== undefined && item.text.trim() !== item.fromType.text;

/** Picks a type: its notes are added as general notes. */
export async function addInspectionType(
  db: InspectionDb,
  inspectionId: string,
  snippet: Snippet,
  now = Date.now(),
): Promise<void> {
  const inspection = await db.inspections.get(inspectionId);
  if (!inspection || inspection.types?.includes(snippet.id)) return;
  await db.inspections.update(inspectionId, {
    types: [...(inspection.types ?? []), snippet.id],
  });
  for (const text of typeNotes(snippet))
    await createGeneralNote(db, inspectionId, now, {
      text,
      fromType: { snippetId: snippet.id, text },
    });
}

/**
 * Removes a type and the notes it added. With `force` false, nothing
 * changes when any of them was edited: the count of edited notes is
 * returned so the caller can ask first.
 */
export async function removeInspectionType(
  db: InspectionDb,
  inspectionId: string,
  snippetId: string,
  force = false,
  now = Date.now(),
): Promise<{ edited: number; removed: boolean }> {
  const notes = await notesFromType(db, inspectionId, snippetId);
  const edited = notes.filter(editedSinceAdded).length;
  if (edited > 0 && !force) return { edited, removed: false };
  await db.transaction(
    "rw",
    [db.inspections, db.drawings, db.items, db.photos, db.blobs],
    async () => {
      const inspection = await db.inspections.get(inspectionId);
      if (!inspection) return;
      await db.inspections.update(inspectionId, {
        types: (inspection.types ?? []).filter((id) => id !== snippetId),
      });
      await deleteItemRecords(db, notes);
      await reletterInspection(db, inspectionId);
      await touchInspection(db, inspectionId, now);
    },
  );
  return { edited, removed: true };
}
