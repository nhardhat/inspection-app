import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { AppBar, BackLink, BarTitle } from "../../app/AppBar";
import { backTarget, rememberBack } from "../../app/backTarget";
import { ConfirmDialog } from "../../app/ConfirmDialog";
import { NotFound } from "../../app/NotFound";
import { saveStateLabel, useAutosave } from "../../app/useAutosave";
import { useRowDrag } from "../../app/useRowDrag";
import { db } from "../../db/db";
import { createInspection } from "../../db/inspections";
import {
  deleteProject,
  jobInspection,
  projectsWithJobNumber,
  updateProject,
  type ProjectPatch,
} from "../../db/projects";
import type { Contact, Project } from "../../db/types";
import {
  Building2,
  ClipboardList,
  Contact as ContactIcon,
  Plus,
  Trash2,
} from "lucide-react";
import { ProjectAvatar } from "./ProjectAvatar";
import { InspectionCard } from "../inspections/InspectionsPage";
import { inspectionTitle } from "../inspections/inspectionTitle";
import {
  JobDetailsForm,
  type JobDetailsValues,
} from "../inspections/JobDetailsForm";
import { PROJECT_FIELDS, toPatch } from "../inspections/jobDetails";
import { tabPath } from "../inspections/tabPath";

/**
 * A project (SPEC section 12): its details (shared by all its
 * inspections), contacts offered for memo recipients, its inspections,
 * and Delete project.
 */
export function ProjectPage() {
  const { id = "" } = useParams();
  const [project, setProject] = useState<Project | null | undefined>();
  useEffect(() => {
    let current = true;
    void db.projects.get(id).then((p) => current && setProject(p ?? null));
    return () => {
      current = false;
    };
  }, [id]);
  if (project === undefined) return null;
  if (project === null) return <NotFound what="Project" />;
  return <ProjectFor key={id} initial={project} />;
}

function ProjectFor({ initial }: { initial: Project }) {
  const navigate = useNavigate();
  const id = initial.id;
  // Loaded once: the form then owns its values, so typing is never overwritten.
  const [values, setValues] = useState<JobDetailsValues>(() => ({
    jobNumber: initial.jobNumber,
    jobName: initial.jobName,
    clientName: initial.client.name,
    clientCompany: initial.client.company,
    address1: initial.client.address1,
    address2: initial.client.address2,
    // Not shown: they belong to each inspection.
    itemInspected: "",
    date: "",
    inspector: "",
  }));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const autosave = useAutosave<ProjectPatch>(
    (patch) => updateProject(db, id, patch),
    (a, b) => ({ ...a, ...b, client: { ...a.client, ...b.client } }),
  );
  const live = useLiveQuery(async () => {
    const [project, inspections] = await Promise.all([
      db.projects.get(id),
      db.inspections.where("projectId").equals(id).toArray(),
    ]);
    inspections.sort((a, b) => b.updatedAt - a.updatedAt);
    return {
      contacts: project?.contacts ?? [],
      inspections: inspections.map((i) => jobInspection(i, project)),
    };
  }, [id]);
  const duplicates =
    useLiveQuery(
      async () =>
        (await projectsWithJobNumber(db, values.jobNumber)).filter(
          (p) => p.id !== id,
        ),
      [values.jobNumber, id],
    ) ?? [];

  const inspections = live?.inspections ?? [];
  const back = backTarget(`project:${id}`);
  const here = `/projects/${id}`;
  const title = inspectionTitle(values);

  async function setContacts(contacts: Contact[]) {
    await updateProject(db, id, {
      contacts: contacts.filter((c) => c.company.trim() || c.attn.trim()),
    });
  }

  return (
    <section className="project-page">
      <AppBar
        left={
          <>
            <BackLink to={back.path} label={back.label} />
            <BarTitle kicker="Project" heading={title} />
          </>
        }
        right={
          <span className="save-state" role="status" data-testid="save-state">
            {saveStateLabel(autosave.state)}
          </span>
        }
      />
      <div className="page-title-row">
        <ProjectAvatar project={{ ...initial, ...values }} />
        <div className="page-title-text">
          <h1 data-testid="project-title">{title}</h1>
          {values.clientCompany && (
            <span className="muted">{values.clientCompany}</span>
          )}
        </div>
      </div>

      <div className="settings-cards">
        <section
          className="settings-card"
          aria-labelledby="project-details-heading"
        >
          <h2 id="project-details-heading" className="card-title">
            <span className="card-icon">
              <Building2 aria-hidden="true" />
            </span>
            Project details
          </h2>
          <p className="muted">
            Shared by every inspection in this project and their memos.
          </p>
          <JobDetailsForm
            label="Project details"
            only={PROJECT_FIELDS}
            values={values}
            onChange={(key, value) => {
              setValues((v) => ({ ...v, [key]: value }));
              autosave.queue(toPatch(key, value).project ?? {});
            }}
            onBlur={() => void autosave.flush()}
          />
          {duplicates.length > 0 && (
            <p className="notice" data-testid="duplicate-job">
              Another project also has job number {duplicates[0].jobNumber}:{" "}
              <Link
                to={`/projects/${duplicates[0].id}`}
                onClick={() =>
                  rememberBack(`project:${duplicates[0].id}`, here)
                }
              >
                {inspectionTitle(duplicates[0])}
              </Link>
              .
            </p>
          )}
        </section>

        <section
          className="settings-card"
          aria-labelledby="project-inspections-heading"
        >
          <div className="page-heading">
            <h2 id="project-inspections-heading" className="card-title">
              <span className="card-icon">
                <ClipboardList aria-hidden="true" />
              </span>
              Inspections
            </h2>
            <button
              type="button"
              className="primary"
              onClick={async () => {
                const inspection = await createInspection(db, new Date(), id);
                rememberBack(`inspection:${inspection.id}`, here);
                navigate(tabPath(inspection.id, "details"));
              }}
            >
              <Plus aria-hidden="true" /> New inspection
            </button>
          </div>
          {!live ? null : inspections.length === 0 ? (
            <p className="muted">No inspections in this project yet.</p>
          ) : (
            <ul className="list-panel" aria-label="Project inspections">
              {inspections.map((i) => (
                <InspectionCard key={i.id} inspection={i} from={here} />
              ))}
            </ul>
          )}
        </section>

        <section className="settings-card" aria-labelledby="contacts-heading">
          <h2 id="contacts-heading" className="card-title">
            <span className="card-icon">
              <ContactIcon aria-hidden="true" />
            </span>
            Contacts
          </h2>
          <p className="muted">
            Offered when adding memo recipients. Recipients typed into a memo
            are added here.
          </p>
          {live && (
            <ContactsEditor initial={live.contacts} onSave={setContacts} />
          )}
        </section>
      </div>

      <div className="page-actions">
        <button
          type="button"
          className="danger-outline"
          onClick={() => setConfirmDelete(true)}
        >
          <Trash2 aria-hidden="true" /> Delete project
        </button>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete project?"
        confirmLabel="Delete"
        danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          autosave.cancel();
          setConfirmDelete(false);
          void deleteProject(db, id).then(() => navigate("/inspections"));
        }}
      >
        <p>
          <strong>{title}</strong>
          {inspections.length > 0 ? (
            <>
              {" "}
              and its{" "}
              <strong>
                {inspections.length} inspection
                {inspections.length === 1 ? "" : "s"}
              </strong>{" "}
              (with their drawings, items, photos and memos) will be removed
              from this device.
            </>
          ) : (
            " will be removed from this device."
          )}
        </p>
        <p>This can&rsquo;t be undone. Backups arrive in a later build.</p>
      </ConfirmDialog>
    </section>
  );
}

/** Contacts, loaded once and saved as you type (like the other fields). */
function ContactsEditor({
  initial,
  onSave,
}: {
  initial: Contact[];
  onSave: (contacts: Contact[]) => Promise<void>;
}) {
  const [rows, setRows] = useState(initial);
  const autosave = useAutosave<Contact[]>(onSave, (_, later) => later);
  const update = (next: Contact[]) => {
    setRows(next);
    autosave.queue(next);
  };
  const change = (i: number, patch: Partial<Contact>) =>
    update(rows.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  // Drag ≡ to set the order "Add from contacts" offers them in.
  const reorder = useRowDrag(
    rows.map((c) => c.id),
    (order) => {
      update(order.map((id) => rows.find((c) => c.id === id)!));
      void autosave.flush();
    },
  );

  return (
    <>
      {rows.length === 0 ? (
        <p className="muted">No contacts yet.</p>
      ) : (
        <table className="memo-recipients" aria-label="Contacts">
          <thead>
            <tr>
              <th>
                <span className="sr-only">Reorder</span>
              </th>
              <th>Company</th>
              <th>Attn</th>
              <th>
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c, i) => (
              <tr
                key={c.id}
                ref={reorder.rowRef(c.id)}
                className={
                  reorder.draggingId === c.id
                    ? "reorder-row-dragged"
                    : undefined
                }
                style={{
                  transform: `translateY(${reorder.shift(c.id)}px)`,
                  transition:
                    reorder.draggingId === null || reorder.draggingId === c.id
                      ? "none"
                      : undefined,
                }}
              >
                <td>
                  {rows.length > 1 && (
                    <button
                      type="button"
                      className="drag-handle"
                      aria-label={`Reorder contact ${i + 1}`}
                      title="Drag to reorder"
                      {...reorder.handleProps(c.id)}
                    >
                      ≡
                    </button>
                  )}
                </td>
                <td>
                  <input
                    aria-label={`Contact ${i + 1} company`}
                    value={c.company}
                    autoCapitalize="words"
                    onChange={(e) => change(i, { company: e.target.value })}
                    onBlur={() => void autosave.flush()}
                  />
                </td>
                <td>
                  <input
                    aria-label={`Contact ${i + 1} attention`}
                    value={c.attn}
                    autoCapitalize="words"
                    onChange={(e) => change(i, { attn: e.target.value })}
                    onBlur={() => void autosave.flush()}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    aria-label={`Remove contact ${i + 1}`}
                    onClick={() => update(rows.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="button-row">
        <button
          type="button"
          onClick={() =>
            setRows([
              ...rows,
              { id: crypto.randomUUID(), company: "", attn: "" },
            ])
          }
        >
          Add contact
        </button>
      </p>
    </>
  );
}
