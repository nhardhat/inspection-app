import type { UpdateSpec } from "dexie";
import {
  deleteInspection,
  emptyClient,
  type InspectionPatch,
} from "./inspections";
import type { InspectionDb } from "./schema";
import type {
  Client,
  Contact,
  Inspection,
  JobInspection,
  Project,
} from "./types";

/** Project fields the job details form edits. Client fields are merged. */
export interface ProjectPatch {
  jobNumber?: string;
  jobName?: string;
  client?: Partial<Client>;
  referencePrefix?: string;
}

/** One edit to the job details: the project's part and the inspection's. */
export interface JobPatch {
  project?: ProjectPatch;
  inspection?: InspectionPatch;
}

/** The inspection with its project's job details (blank without one). */
export function jobInspection(
  inspection: Inspection,
  project: Project | null | undefined,
): JobInspection {
  return {
    ...inspection,
    jobNumber: project?.jobNumber ?? "",
    jobName: project?.jobName ?? inspection.unsorted?.jobName ?? "",
    client: project?.client ?? inspection.unsorted?.client ?? emptyClient(),
  };
}

export async function loadJobInspection(
  db: InspectionDb,
  inspectionId: string,
): Promise<JobInspection | undefined> {
  const inspection = await db.inspections.get(inspectionId);
  if (!inspection) return undefined;
  const project = inspection.projectId
    ? await db.projects.get(inspection.projectId)
    : null;
  return jobInspection(inspection, project);
}

/** Contacts match on company and attn, ignoring case and spaces. */
export const contactKey = (c: Pick<Contact, "company" | "attn">) =>
  `${c.company.trim().toLowerCase()}\n${c.attn.trim().toLowerCase()}`;

/**
 * Contacts with `incoming` added, skipping blanks and ones already there
 * (same company and attn, ignoring case and spaces).
 */
export function mergeContacts(
  existing: Contact[],
  incoming: Pick<Contact, "company" | "attn">[],
): Contact[] {
  const seen = new Set(existing.map(contactKey));
  const merged = [...existing];
  for (const c of incoming) {
    const company = c.company.trim();
    const attn = c.attn.trim();
    if (!company && !attn) continue;
    const key = contactKey({ company, attn });
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ id: crypto.randomUUID(), company, attn });
  }
  return merged;
}

/** Same job number, ignoring case and spaces (warns before a duplicate). */
export async function projectsWithJobNumber(
  db: InspectionDb,
  jobNumber: string,
): Promise<Project[]> {
  const wanted = jobNumber.trim().toUpperCase();
  if (!wanted) return [];
  return db.projects
    .filter((p) => p.jobNumber.trim().toUpperCase() === wanted)
    .toArray();
}

export async function createProject(
  db: InspectionDb,
  details: { jobNumber: string; jobName: string; client?: Client },
  now = Date.now(),
): Promise<Project> {
  const project: Project = {
    id: crypto.randomUUID(),
    jobNumber: details.jobNumber.trim(),
    jobName: details.jobName.trim(),
    client: details.client ?? emptyClient(),
    contacts: [],
    createdAt: now,
    updatedAt: now,
  };
  await db.projects.add(project);
  return project;
}

export async function updateProject(
  db: InspectionDb,
  id: string,
  patch: ProjectPatch & { contacts?: Contact[] },
  now = Date.now(),
): Promise<void> {
  const { client, ...top } = patch;
  const changes: Record<string, unknown> = { ...top, updatedAt: now };
  // Dotted key paths update one client field without overwriting the others.
  for (const [key, value] of Object.entries(client ?? {}))
    changes[`client.${key}`] = value;
  const updated = await db.projects.update(id, changes as UpdateSpec<Project>);
  if (updated === 0) throw new Error(`Project ${id} not found`);
}

export function mergeJobPatches(a: JobPatch, b: JobPatch): JobPatch {
  return {
    project: {
      ...a.project,
      ...b.project,
      client: { ...a.project?.client, ...b.project?.client },
    },
    inspection: { ...a.inspection, ...b.inspection },
  };
}

/**
 * Saves an edit to the job details: project fields to the inspection's
 * project (so every inspection in it changes), the rest to the inspection.
 * The inspection counts as edited either way.
 */
export async function saveJob(
  db: InspectionDb,
  inspectionId: string,
  patch: JobPatch,
  now = Date.now(),
): Promise<void> {
  await db.transaction("rw", [db.inspections, db.projects], async () => {
    const inspection = await db.inspections.get(inspectionId);
    if (!inspection) throw new Error(`Inspection ${inspectionId} not found`);
    await db.inspections.update(inspectionId, {
      ...patch.inspection,
      updatedAt: now,
    });
    const project = patch.project;
    const changed =
      project &&
      (project.jobNumber !== undefined ||
        project.jobName !== undefined ||
        Object.keys(project.client ?? {}).length > 0);
    if (changed && inspection.projectId)
      await updateProject(db, inspection.projectId, project, now);
  });
}

/** Puts an inspection in a project (or moves it). Its memo keeps its reference. */
export async function assignInspection(
  db: InspectionDb,
  inspectionId: string,
  projectId: string,
  now = Date.now(),
): Promise<void> {
  await db.transaction("rw", [db.inspections], async () => {
    const inspection = await db.inspections.get(inspectionId);
    if (!inspection) throw new Error(`Inspection ${inspectionId} not found`);
    const moved: Inspection = { ...inspection, projectId, updatedAt: now };
    // Its pre-project details were only kept to start a project from.
    delete moved.unsorted;
    await db.inspections.put(moved);
  });
}

/**
 * Starts a project for an inspection that has none, with the client and
 * address it had before projects existed, and puts it in.
 */
export async function startProjectFor(
  db: InspectionDb,
  inspectionId: string,
  details: { jobNumber: string; jobName: string },
  now = Date.now(),
): Promise<Project> {
  return db.transaction("rw", [db.inspections, db.projects], async () => {
    const inspection = await db.inspections.get(inspectionId);
    if (!inspection) throw new Error(`Inspection ${inspectionId} not found`);
    const project = await createProject(
      db,
      { ...details, client: inspection.unsorted?.client },
      now,
    );
    await assignInspection(db, inspectionId, project.id, now);
    return project;
  });
}

/** Remembers memo recipients as the project's contacts (no duplicates). */
export async function rememberContacts(
  db: InspectionDb,
  projectId: string,
  recipients: Pick<Contact, "company" | "attn">[],
): Promise<void> {
  await db.transaction("rw", [db.projects], async () => {
    const project = await db.projects.get(projectId);
    if (!project) return;
    const contacts = mergeContacts(project.contacts, recipients);
    if (contacts.length !== project.contacts.length)
      await db.projects.update(projectId, { contacts });
  });
}

/**
 * Deletes a project and every inspection in it (with their drawings,
 * photos and memos). Memo counters are kept, so references aren't reused.
 */
export async function deleteProject(
  db: InspectionDb,
  projectId: string,
): Promise<void> {
  await db.transaction(
    "rw",
    [
      db.projects,
      db.inspections,
      db.drawings,
      db.items,
      db.photos,
      db.blobs,
      db.observationBoxes,
      db.memos,
      db.markups,
    ],
    async () => {
      const inspections = await db.inspections
        .where("projectId")
        .equals(projectId)
        .toArray();
      for (const inspection of inspections)
        await deleteInspection(db, inspection.id);
      await db.projects.delete(projectId);
    },
  );
}
