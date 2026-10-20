import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { ConfirmDialog } from "../../app/ConfirmDialog";
import { db } from "../../db/db";
import {
  addInspectionType,
  removeInspectionType,
} from "../../db/inspectionTypes";
import type { Snippet } from "../../db/types";

/**
 * Pre-inspection: the inspection's types (General concrete, steel,
 * piling…; engineer, 2026-10-20), as toggle buttons. Picking one adds its
 * general notes; removing it takes them away, asking first if any was
 * edited. The types and their notes are edited in Settings.
 */
export function InspectionTypes({ inspectionId }: { inspectionId: string }) {
  const types = useLiveQuery(
    () => db.snippets.where("kind").equals("inspectionType").toArray(),
    [],
  );
  const picked = useLiveQuery(
    async () => (await db.inspections.get(inspectionId))?.types ?? [],
    [inspectionId],
  );
  const [asking, setAsking] = useState<{
    type: Snippet;
    edited: number;
  } | null>(null);
  if (!types || !picked || types.length === 0) return null;

  async function toggle(type: Snippet) {
    if (!picked!.includes(type.id))
      return addInspectionType(db, inspectionId, type);
    const { edited, removed } = await removeInspectionType(
      db,
      inspectionId,
      type.id,
    );
    if (!removed) setAsking({ type, edited });
  }

  return (
    <div className="inspection-types">
      <span className="field-label" id="inspection-types-label">
        Inspection type
      </span>
      <div
        className="chip-row"
        role="group"
        aria-labelledby="inspection-types-label"
      >
        {types.map((type) => (
          <button
            key={type.id}
            type="button"
            className={`chip-toggle${picked.includes(type.id) ? " toggle-on" : ""}`}
            aria-pressed={picked.includes(type.id)}
            onClick={() => void toggle(type)}
          >
            {type.label}
          </button>
        ))}
      </div>
      <p className="muted small">
        Each type adds its general notes (edit them in Settings, Prefilled
        messages).
      </p>
      <ConfirmDialog
        open={asking !== null}
        title={`Remove ${asking?.type.label ?? ""}?`}
        confirmLabel="Remove"
        danger
        onCancel={() => setAsking(null)}
        onConfirm={() => {
          const type = asking?.type;
          setAsking(null);
          if (type) void removeInspectionType(db, inspectionId, type.id, true);
        }}
      >
        <p>
          {asking?.edited === 1
            ? "One of its general notes was edited. It"
            : `${asking?.edited} of its general notes were edited. They`}{" "}
          will be removed with the rest.
        </p>
      </ConfirmDialog>
    </div>
  );
}
