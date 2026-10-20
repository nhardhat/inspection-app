import { useLiveQuery } from "dexie-react-hooks";
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { AppBar, BackLink, BarTitle } from "../../app/AppBar";
import { backTarget } from "../../app/backTarget";
import { db } from "../../db/db";
import { missingJobFields } from "../../db/inspections";
import { getMemo } from "../../db/memos";
import { loadJobInspection } from "../../db/projects";
import { inspectionTitle } from "./inspectionTitle";
import { tabPath, type InspectionTab } from "./tabPath";

type Tone = "ok" | "todo" | "danger" | "plain";

interface Step {
  key: InspectionTab;
  label: string;
  status: string;
  tone: Tone;
  done: boolean;
}

/** Each step's status line, from the inspection as saved. */
function useSteps(inspectionId: string): Step[] | undefined {
  return useLiveQuery(async () => {
    const [job, drawings, items, memo] = await Promise.all([
      loadJobInspection(db, inspectionId),
      db.drawings
        .where("inspectionId")
        .equals(inspectionId)
        .filter((d) => !d.sketch)
        .count(),
      db.items.where("inspectionId").equals(inspectionId).count(),
      getMemo(db, inspectionId),
    ]);
    if (!job) return undefined;
    const detailsDone = !!job.projectId && missingJobFields(job).length === 0;
    const plural = (n: number, word: string) =>
      `${n} ${word}${n === 1 ? "" : "s"}`;
    return [
      {
        key: "details",
        label: "Pre-inspection",
        status: !job.projectId
          ? "Needs a project"
          : detailsDone
            ? "Job details done"
            : "Job number and name needed",
        tone: !job.projectId ? "danger" : detailsDone ? "ok" : "todo",
        done: detailsDone,
      },
      {
        key: "inspection",
        label: "Inspection",
        status: drawings
          ? `${plural(drawings, "drawing")} · ${plural(items, "item")}`
          : "Add drawings",
        tone: items ? "ok" : "plain",
        done: items > 0,
      },
      {
        key: "memo",
        label: "Site memo",
        status: memo ? memo.reference : "Not started",
        tone: memo ? "ok" : "plain",
        done: !!memo,
      },
    ];
  }, [inspectionId]);
}

const STEPS: { key: InspectionTab; label: string }[] = [
  { key: "details", label: "Pre-inspection" },
  { key: "inspection", label: "Inspection" },
  { key: "memo", label: "Site memo" },
];

/**
 * The inspection's three steps (SPEC section 12): Pre-inspection,
 * Inspection, Site memo, as a segmented control in the top bar. A done
 * step shows a tick; each step's status is read out to screen readers.
 */
export function InspectionTabs({
  inspectionId,
  current,
}: {
  inspectionId: string;
  current: InspectionTab;
}) {
  const steps = useSteps(inspectionId);
  return (
    <nav className="bar-segments" aria-label="Inspection sections">
      {STEPS.map((base, i) => {
        const step = steps?.[i];
        const isCurrent = base.key === current;
        return (
          <Link
            key={base.key}
            to={tabPath(inspectionId, base.key)}
            aria-label={base.label}
            aria-current={isCurrent ? "page" : undefined}
            title={step?.status}
            data-tone={step?.tone ?? "plain"}
          >
            {step?.done && !isCurrent && (
              <Check aria-hidden="true" className="step-done" />
            )}
            {base.label}
            {step && (
              <span className="sr-only" data-testid={`step-status-${base.key}`}>
                {step.status}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * The top bar inside an inspection: back (to where it was opened from), the
 * job and item inspected, the steps, and e.g. the save state.
 */
export function InspectionHeader({
  inspectionId,
  title,
  current,
  status,
}: {
  inspectionId: string;
  /** Shown instead of the saved title (e.g. while job details are typed). */
  title?: string;
  current: InspectionTab;
  /** E.g. the save state, shown on the right. */
  status?: ReactNode;
}) {
  const job = useLiveQuery(
    () => loadJobInspection(db, inspectionId),
    [inspectionId],
  );
  const back = backTarget(`inspection:${inspectionId}`);
  const item = job?.itemInspected.trim();
  const jobTitle = (
    <span data-testid="inspection-title">
      {title ?? (job ? inspectionTitle(job) : "")}
    </span>
  );
  return (
    <AppBar
      left={
        <>
          <BackLink to={back.path} label={back.label} />
          {item ? (
            <BarTitle kicker={jobTitle} heading={item} />
          ) : (
            <BarTitle heading={jobTitle} />
          )}
        </>
      }
      centre={<InspectionTabs inspectionId={inspectionId} current={current} />}
      right={status}
    />
  );
}
