import { touchInspection } from "./items";
import { loadJobInspection, rememberContacts } from "./projects";
import type { InspectionDb } from "./schema";
import {
  SETTINGS_ID,
  type JobInspection,
  type Memo,
  type Settings,
} from "./types";

export const MEMO_TEMPLATE_ID = "northrop";

/** The letters a reference starts with when a project sets none. */
export const DEFAULT_REFERENCE_PREFIX = "SIM";

/** A project's reference letters, cleaned: capitals only, up to 6; else SIM. */
export function referencePrefix(typed: string | undefined): string {
  const letters = (typed ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  return letters.slice(0, 6) || DEFAULT_REFERENCE_PREFIX;
}

/**
 * "SIM001" for sequence 1, or with the project's letters ("SSI001";
 * engineer, 2026-10-16: no hyphen, three digits). SPEC 7a.
 */
export function memoReference(seq: number, prefix?: string): string {
  return `${referencePrefix(prefix)}${String(seq).padStart(3, "0")}`;
}

/** A new memo's starting values (SPEC section 4). */
export function blankMemo(
  inspection: Pick<JobInspection, "id" | "client">,
  reference: string,
  settings: Pick<
    Settings,
    "inspectorName" | "inspectorTitle" | "defaultSentVia"
  >,
  body: { id: string; text: string } | null,
  now = Date.now(),
): Memo {
  const { name, company } = inspection.client;
  return {
    id: crypto.randomUUID(),
    inspectionId: inspection.id,
    templateId: MEMO_TEMPLATE_ID,
    reference,
    // The client is the first "To" recipient when job details have one.
    recipients: [
      { company: company.trim(), attn: name.trim(), to: true, copy: false },
    ],
    siteVisitRequestedBy: null,
    reasonForVisit: null,
    sentVia: settings.defaultSentVia,
    salutation: null,
    bodySnippetId: body?.id ?? null,
    bodyText: body?.text ?? "",
    conditionChoices: {},
    itemOverrides: {},
    signOffName: settings.inspectorName,
    signOffTitle: settings.inspectorTitle,
    signatureBlobId: null,
    includeSignature: true,
    createdAt: now,
    updatedAt: now,
  };
}

/** The inspection's memo, if it has one. */
export async function getMemo(
  db: InspectionDb,
  inspectionId: string,
): Promise<Memo | undefined> {
  return db.memos.where("inspectionId").equals(inspectionId).first();
}

/** The body message a new memo starts with (SPEC section 4). */
const DEFAULT_BODY_ID = "body-works-generally-in-accordance";

/**
 * Creates the inspection's memo with the job's next reference (the
 * project's letters, else SIM), or returns the one it already has. Needs a
 * job number and job name.
 */
export async function createMemo(
  db: InspectionDb,
  inspectionId: string,
  now = Date.now(),
): Promise<Memo> {
  return db.transaction(
    "rw",
    [
      db.inspections,
      db.memos,
      db.memoCounters,
      db.settings,
      db.snippets,
      db.blobs,
      db.projects,
    ],
    async () => {
      const existing = await getMemo(db, inspectionId);
      if (existing) return existing;
      const inspection = await loadJobInspection(db, inspectionId);
      if (!inspection) throw new Error(`Inspection ${inspectionId} not found`);
      const jobNumber = inspection.jobNumber.trim();
      if (!jobNumber || !inspection.jobName.trim())
        throw new Error("A memo needs a job number and job name");

      // References count per job number and are never reused.
      const counter = await db.memoCounters.get(jobNumber);
      const seq = (counter?.lastSeq ?? 0) + 1;
      await db.memoCounters.put({ jobNumber, lastSeq: seq });
      const project = inspection.projectId
        ? await db.projects.get(inspection.projectId)
        : undefined;

      const settings = await db.settings.get(SETTINGS_ID);
      const bodies = await db.snippets.where("kind").equals("body").toArray();
      const body = bodies.find((s) => s.id === DEFAULT_BODY_ID) ?? bodies[0];
      const memo = blankMemo(
        inspection,
        memoReference(seq, project?.referencePrefix),
        {
          inspectorName: settings?.inspectorName ?? "",
          inspectorTitle: settings?.inspectorTitle ?? "",
          defaultSentVia: settings?.defaultSentVia ?? "Email",
        },
        body ?? null,
        now,
      );
      // The memo keeps its own copy of my signature, so it travels with
      // the inspection and later changes in Settings don't alter it.
      const mine = settings?.signatureBlobId
        ? await db.blobs.get(settings.signatureBlobId)
        : undefined;
      if (mine) {
        memo.signatureBlobId = crypto.randomUUID();
        await db.blobs.add({ ...mine, id: memo.signatureBlobId });
      }
      await db.memos.add(memo);
      // The client is offered as a contact from now on.
      if (inspection.projectId)
        await rememberContacts(db, inspection.projectId, memo.recipients);
      await touchInspection(db, inspectionId, now);
      return memo;
    },
  );
}

/** Fields the memo editor changes (everything but identity and times). */
export type MemoPatch = Partial<
  Omit<Memo, "id" | "inspectionId" | "templateId" | "createdAt" | "updatedAt">
>;

export async function updateMemo(
  db: InspectionDb,
  id: string,
  patch: MemoPatch,
  now = Date.now(),
): Promise<void> {
  await db.transaction("rw", [db.inspections, db.memos], async () => {
    const memo = await db.memos.get(id);
    if (!memo) throw new Error(`Memo ${id} not found`);
    await db.memos.update(id, { ...patch, updatedAt: now });
    await touchInspection(db, memo.inspectionId, now);
  });
}

/**
 * Records an export of the PDF pack: when, and each item's letter at the
 * time, so the app can warn if letters change before the memo is sent.
 * Not an edit, so the memo's updatedAt is left alone.
 */
export async function markMemoExported(
  db: InspectionDb,
  id: string,
  exportedLetters: Record<string, string>,
  now = Date.now(),
): Promise<void> {
  await db.memos.update(id, { exportedAt: now, exportedLetters });
}
