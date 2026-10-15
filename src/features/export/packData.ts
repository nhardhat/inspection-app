/** Loads what the export pack is built from (see buildPack.ts). */
import { listDrawings } from "../../db/drawings";
import { listMarkups } from "../../db/markups";
import { getMemo } from "../../db/memos";
import { loadJobInspection } from "../../db/projects";
import type { InspectionDb } from "../../db/schema";
import { observationHeading } from "../drawings/observationBox";
import { photoLine, referLine } from "../memo/buildMemo";
import type { LoadBlob, PackData } from "./packContents";

/** Null when the inspection or its memo is missing. */
export async function loadPackData(
  db: InspectionDb,
  inspectionId: string,
): Promise<PackData | null> {
  const [inspection, memo, items, drawings, snippets, marks] =
    await Promise.all([
      loadJobInspection(db, inspectionId),
      getMemo(db, inspectionId),
      db.items.where("inspectionId").equals(inspectionId).toArray(),
      listDrawings(db, inspectionId),
      db.snippets.toArray(),
      listMarkups(db, inspectionId),
    ]);
  if (!inspection || !memo) return null;
  const drawingIds = new Set(drawings.map((d) => d.id));
  const [boxes, photoList, signature] = await Promise.all([
    db.observationBoxes.filter((b) => drawingIds.has(b.drawingId)).toArray(),
    db.photos.bulkGet([
      ...items.flatMap((item) => item.photoIds),
      ...inspection.photoIds,
    ]),
    memo.includeSignature && memo.signatureBlobId
      ? db.blobs.get(memo.signatureBlobId)
      : undefined,
  ]);
  return {
    inspection,
    memo,
    items,
    drawings,
    boxes,
    marks,
    conditionSnippets: snippets.filter((s) => s.kind === "condition"),
    photoLine: photoLine(snippets),
    referLine: referLine(snippets),
    observationHeading: observationHeading(
      snippets.filter((s) => s.kind === "heading"),
    ),
    photos: new Map(
      photoList.filter((p) => p !== undefined).map((p) => [p.id, p]),
    ),
    signature: signature ? new Uint8Array(signature.data) : null,
  };
}

/** Reads a stored file for the pack. */
export function blobLoader(db: InspectionDb): LoadBlob {
  return async (id) => {
    const blob = await db.blobs.get(id);
    if (!blob) throw new Error(`Stored file ${id} is missing`);
    return { data: new Uint8Array(blob.data), type: blob.type };
  };
}
