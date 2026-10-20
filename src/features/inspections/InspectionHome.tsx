import { useCallback, useEffect, useState } from "react";
import { InspectionTypes } from "./InspectionTypes";
import { ArrowRight, FolderSearch, Trash2 } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";
import { rememberBack } from "../../app/backTarget";
import { NotFound } from "../../app/NotFound";
import { saveStateLabel, useAutosave } from "../../app/useAutosave";
import { db } from "../../db/db";
import { deleteInspection, missingJobFields } from "../../db/inspections";
import {
  assignInspection,
  createProject,
  loadJobInspection,
  saveJob,
  startProjectFor,
  type JobPatch,
} from "../../db/projects";
import type { JobInspection } from "../../db/types";
import { BackupCard } from "../backup/BackupCard";
import { DrawingsSection } from "../drawings/DrawingsSection";
import { ProjectAvatar } from "../projects/ProjectAvatar";
import { ProjectPicker } from "../projects/ProjectPicker";
import { DeleteInspectionDialog } from "./DeleteInspectionDialog";
import { InspectionHeader } from "./InspectionTabs";
import { tabPath } from "./tabPath";
import { inspectionTitle } from "./inspectionTitle";
import { JobDetailsForm, type JobDetailsValues } from "./JobDetailsForm";
import {
  INSPECTION_FIELDS,
  PROJECT_FIELDS,
  mergePatches,
  toPatch,
  toValues,
  withValues,
} from "./jobDetails";

type Load =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "ready"; inspection: JobInspection };

/**
 * Pre-inspection tab: the inspection's project (shared job details,
 * Change project) or, without one, the Needs a project flag; its own
 * details; and Delete inspection. Everything autosaves.
 */
export function PreInspectionScreen() {
  const { id = "" } = useParams();
  return <PreInspectionFor key={id} id={id} />;
}

function PreInspectionFor({ id }: { id: string }) {
  const navigate = useNavigate();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [values, setValues] = useState<JobDetailsValues | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [picking, setPicking] = useState<"change" | "new" | "assign" | null>(
    null,
  );
  const autosave = useAutosave<JobPatch>(
    (patch) => saveJob(db, id, patch),
    mergePatches,
  );

  // Load once (and again after the project changes): the form then owns
  // the values, so typing is never overwritten.
  const show = useCallback((inspection: JobInspection | undefined) => {
    if (!inspection) return setLoad({ status: "missing" });
    setLoad({ status: "ready", inspection });
    setValues(toValues(inspection));
  }, []);
  const reload = async () => show(await loadJobInspection(db, id));
  useEffect(() => {
    let current = true;
    void loadJobInspection(db, id).then((found) => current && show(found));
    return () => {
      current = false;
    };
  }, [id, show]);

  if (load.status === "loading") return null;
  if (load.status === "missing" || !values)
    return <NotFound what="Inspection" />;

  const { inspection } = load;
  const hasProject = inspection.projectId !== null;
  const missing = missingJobFields(values);

  function change(key: keyof JobDetailsValues, value: string) {
    setValues((v) => (v ? { ...v, [key]: value } : v));
    autosave.queue(toPatch(key, value));
  }

  async function choose(projectId: string) {
    setPicking(null);
    await autosave.flush();
    await assignInspection(db, id, projectId);
    await reload();
  }

  return (
    <section className="inspection-home">
      <InspectionHeader
        inspectionId={id}
        title={inspectionTitle(values)}
        current="details"
        status={
          <span className="save-state" role="status" data-testid="save-state">
            {saveStateLabel(autosave.state)}
          </span>
        }
      />

      <div className="detail-columns">
        <section className="card detail-card" aria-labelledby="project-heading">
          {hasProject ? (
            <>
              <div className="detail-card-head">
                <ProjectAvatar
                  project={{
                    id: inspection.projectId!,
                    jobName: values.jobName,
                    jobNumber: values.jobNumber,
                  }}
                />
                <div className="list-row-main">
                  <h2 id="project-heading" className="eyebrow">
                    Project · shared by its inspections
                  </h2>
                  <Link
                    to={`/projects/${inspection.projectId}`}
                    className="detail-project-link"
                    data-testid="project-link"
                    onClick={() =>
                      rememberBack(
                        `project:${inspection.projectId}`,
                        tabPath(id, "details"),
                      )
                    }
                  >
                    {inspectionTitle(values)}
                  </Link>
                </div>
                <button type="button" onClick={() => setPicking("change")}>
                  Change project
                </button>
              </div>
              <p className="muted detail-hint">
                Changing these changes them for every inspection in the project.
              </p>
              {missing.length > 0 && (
                <p className="notice" data-testid="missing-fields">
                  {missing.length === 2
                    ? "Job number and job name are"
                    : missing[0] === "jobNumber"
                      ? "Job number is"
                      : "Job name is"}{" "}
                  needed before a memo can be created.
                </p>
              )}
              <JobDetailsForm
                label="Project details"
                only={PROJECT_FIELDS}
                values={values}
                onChange={change}
                onBlur={() => void autosave.flush()}
              />
            </>
          ) : (
            <div className="needs-project" data-testid="needs-project">
              <span className="empty-state-icon">
                <FolderSearch aria-hidden="true" />
              </span>
              <h2 id="project-heading">
                <span className="flag">Needs a project</span>
              </h2>
              <p className="muted">
                This inspection isn&rsquo;t in a project yet. A memo needs one
                (for the job number and client).
              </p>
              <p className="button-row">
                <button
                  type="button"
                  className="primary"
                  onClick={() => setPicking("new")}
                >
                  Create new project
                </button>
                <button type="button" onClick={() => setPicking("assign")}>
                  Assign to project
                </button>
              </p>
            </div>
          )}
        </section>

        <div className="detail-stack">
          <section
            className="card detail-card"
            aria-labelledby="inspection-heading"
          >
            <h2 id="inspection-heading" className="eyebrow">
              This inspection
            </h2>
            <JobDetailsForm
              label="Inspection details"
              only={INSPECTION_FIELDS}
              values={values}
              onChange={change}
              onBlur={() => void autosave.flush()}
            />
            <InspectionTypes inspectionId={id} />
          </section>

          {/* Drawings are loaded here before going to site. */}
          <section className="card detail-card pre-drawings">
            <DrawingsSection
              inspectionId={id}
              onOpen={(drawingId) =>
                navigate(`${tabPath(id, "inspection")}?drawing=${drawingId}`)
              }
            />
            <div className="pre-drawings-actions">
              <Link
                to={`${tabPath(id, "inspection")}?pages=1`}
                className="button-link"
              >
                Pages
              </Link>
              <Link
                to={tabPath(id, "inspection")}
                className="button-link emphasis pre-drawings-next"
              >
                Start the inspection <ArrowRight aria-hidden="true" />
              </Link>
            </div>
          </section>

          <BackupCard inspectionId={id} />

          <button
            type="button"
            className="danger-outline detail-delete"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 aria-hidden="true" /> Delete inspection
          </button>
        </div>
      </div>

      <ProjectPicker
        open={picking !== null}
        title={
          picking === "new"
            ? "Create new project"
            : picking === "assign"
              ? "Assign to project"
              : "Change project"
        }
        mode={
          picking === "new" ? "new" : picking === "assign" ? "pick" : "both"
        }
        initial={{ jobName: inspection.unsorted?.jobName ?? "" }}
        excludeProjectId={inspection.projectId}
        onPick={(projectId) => void choose(projectId)}
        onCreate={async (details) => {
          if (hasProject) {
            const project = await createProject(db, details);
            await choose(project.id);
          } else {
            // Starts from the client and address it had.
            setPicking(null);
            await autosave.flush();
            await startProjectFor(db, id, details);
            await reload();
          }
        }}
        onCancel={() => setPicking(null)}
      />

      <DeleteInspectionDialog
        inspection={confirmDelete ? withValues(inspection, values) : null}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          autosave.cancel();
          setConfirmDelete(false);
          void deleteInspection(db, id).then(() => navigate("/inspections"));
        }}
      />
    </section>
  );
}
