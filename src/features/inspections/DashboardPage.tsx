import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowUpRight,
  Check,
  FileText,
  MapPin,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Buddy } from "../../app/Buddy";
import { appCommit, appVersion } from "../../app/version";
import { northrop } from "../../brand/northrop";
import { db } from "../../db/db";
import { jobInspection } from "../../db/projects";
import {
  NEARLY_FULL,
  formatBytes,
  getStorageStatus,
  type StorageStatus,
} from "../../db/storage";
import { SETTINGS_ID, type JobInspection } from "../../db/types";
import { DrawingThumb } from "./DrawingThumb";
import {
  editedAgo,
  emptyProgress,
  greeting,
  longToday,
  monthStats,
  needsAttention,
  nextStep,
  progressByInspection,
  stepsDone,
  titleOf,
  type Attention,
  type InspectionProgress,
} from "./homeData";
import {
  InspectionAvatar,
  InspectionLink,
  NewInspectionButton,
} from "./inspectionParts";
import { inspectionTitle } from "./inspectionTitle";
import type { InspectionTab } from "./tabPath";

/** Where the dashboard's links say back goes. */
const HERE = "/";

/**
 * Dashboard (SPEC section 12): a greeting and tiles: the inspection to
 * carry on with, this month's items and memos, what needs attention, and
 * storage. Inspections, Recent and Projects are on the Inspections tab.
 */
export function DashboardPage() {
  const data = useLiveQuery(async () => {
    const [inspections, projects, memos, items, drawings, settings] =
      await Promise.all([
        db.inspections.orderBy("updatedAt").reverse().toArray(),
        db.projects.toArray(),
        db.memos.toArray(),
        db.items.toArray(),
        db.drawings.toArray(),
        db.settings.get(SETTINGS_ID),
      ]);
    const byId = new Map(projects.map((p) => [p.id, p]));
    const latestMemo = [...memos].sort((a, b) => b.createdAt - a.createdAt)[0];
    return {
      inspections: inspections.map((i) =>
        jobInspection(i, i.projectId ? byId.get(i.projectId) : null),
      ),
      projectCount: projects.length,
      progress: progressByInspection(inspections, memos, items, drawings),
      month: monthStats(inspections, memos, items),
      latestMemo: latestMemo?.reference ?? null,
      name: settings?.inspectorName ?? "",
    };
  }, []);

  if (!data) return null;

  if (data.inspections.length === 0 && data.projectCount === 0)
    return (
      <section className="home">
        <div className="empty-state home-first-run">
          <img
            className="home-wordmark"
            src={northrop.assets.wordmarkRed}
            alt={northrop.name}
          />
          {/* The app's buddy welcomes a new user (app only, never client-facing). */}
          <Buddy size={72} />
          <h1>Start your first inspection</h1>
          <p className="muted">
            Pick or create the project, add the drawing PDFs, then drop pins on
            site. Everything stays on this iPad.
          </p>
          <NewInspectionButton from={HERE} />
        </div>
        <p className="app-version home-version">
          Version {appVersion} ({appCommit})
        </p>
      </section>
    );

  const latest = data.inspections[0];
  const all = needsAttention(data.inspections, data.progress, Infinity);

  return (
    <section className="home">
      <header className="home-head">
        <div className="home-hello">
          <img
            className="home-wordmark"
            src={northrop.assets.wordmarkRed}
            alt={northrop.name}
          />
          <p className="muted">{longToday()}</p>
          <h1>{greeting(data.name)}</h1>
        </div>
        <NewInspectionButton from={HERE} />
      </header>

      <div className="bento">
        {latest ? (
          <ContinueTile
            inspection={latest}
            progress={data.progress.get(latest.id) ?? emptyProgress()}
          />
        ) : (
          <section className="tile tile-continue tile-start">
            <p className="eyebrow">Get started</p>
            <h2>Start an inspection</h2>
            <p className="muted">Your projects are ready on Inspections.</p>
            <NewInspectionButton from={HERE} />
          </section>
        )}
        <NumberTile
          className="tile-warm"
          label="Items logged"
          value={data.month.items}
          note="this month"
          icon={<MapPin aria-hidden="true" />}
        />
        <AttentionTile attention={all.slice(0, 3)} count={all.length} />
        <NumberTile
          className="tile-plain"
          label="Memos this month"
          value={data.month.memos}
          note={
            data.latestMemo ? (
              <span className="chip chip-ok">Latest {data.latestMemo}</span>
            ) : (
              "None yet"
            )
          }
          icon={<FileText aria-hidden="true" />}
        />
        <StorageTile />
      </div>

      <p className="app-version home-version">
        Version {appVersion} ({appCommit})
      </p>
    </section>
  );
}

/** The steps the Continue tile opens. */
const STEP_LINKS: { tab: InspectionTab; label: string }[] = [
  { tab: "details", label: "Pre-inspection" },
  { tab: "inspection", label: "Inspection" },
  { tab: "memo", label: "Site memo" },
];

/** The inspection edited last: a preview of its drawing and the next step. */
function ContinueTile({
  inspection,
  progress,
}: {
  inspection: JobInspection;
  progress: InspectionProgress;
}) {
  const done = stepsDone(inspection, progress);
  const next = nextStep(inspection, progress);
  return (
    <section className="tile tile-continue" aria-labelledby="continue-heading">
      <div className="tile-head">
        <p className="eyebrow" id="continue-heading">
          Continue where you left off
        </p>
        <span className="chip">Edited {editedAgo(inspection.updatedAt)}</span>
      </div>
      <div className="continue-title">
        <InspectionAvatar inspection={inspection} />
        <div className="list-row-main">
          <h2>{titleOf(inspection)}</h2>
          <span className="list-row-meta">
            {[
              inspection.projectId ? inspectionTitle(inspection) : null,
              inspection.client.company,
            ]
              .filter(Boolean)
              .join(" · ") || "No project yet"}
          </span>
        </div>
      </div>
      <DrawingThumb inspectionId={inspection.id} />
      <ol className="progress-steps" aria-label="Progress">
        {["Pre-inspection", "Inspection", "Site memo"].map((label, i) => (
          <li key={label} className={done[i] ? "done" : undefined}>
            <span className="progress-bar" />
            <span className="progress-label">
              {done[i] && <Check aria-hidden="true" />}
              {label}
              <span className="sr-only">{done[i] ? ", done" : ", to do"}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="continue-foot">
        <span className="muted small">
          {progress.instructions} instruction
          {progress.instructions === 1 ? "" : "s"} · {progress.observations}{" "}
          observation{progress.observations === 1 ? "" : "s"} ·{" "}
          {progress.photos} photo{progress.photos === 1 ? "" : "s"}
        </span>
        {/* Any step, straight from here (engineer, 2026-10-07); the
            suggested next one is dark. */}
        <nav className="step-links" aria-label="Open a step">
          {STEP_LINKS.map((step) => {
            const suggested = step.tab === next.tab;
            return (
              <InspectionLink
                key={step.tab}
                inspection={inspection}
                tab={step.tab}
                from={HERE}
                className={`step-link${suggested ? " suggested" : ""}`}
                title={suggested ? `Next: ${next.label}` : undefined}
              >
                {step.label}
                {suggested && <ArrowUpRight aria-hidden="true" />}
              </InspectionLink>
            );
          })}
        </nav>
      </div>
    </section>
  );
}

/** A tile with one big number. */
function NumberTile({
  className,
  label,
  value,
  note,
  icon,
}: {
  className: string;
  label: string;
  value: number;
  note: ReactNode;
  icon: ReactNode;
}) {
  return (
    <section className={`tile tile-number ${className}`}>
      <div className="tile-head">
        <h2 className="eyebrow">{label}</h2>
        <span className="tile-icon">{icon}</span>
      </div>
      <div className="tile-figure">
        <span className="big-number">{value}</span>
        <span className="tile-note">{note}</span>
      </div>
    </section>
  );
}

/** How many inspections need something, and the first few of them. */
function AttentionTile({
  attention,
  count,
}: {
  attention: Attention[];
  count: number;
}) {
  return (
    <section
      className="tile tile-number tile-dark"
      aria-labelledby="attention-heading"
    >
      <div className="tile-head">
        <h2 id="attention-heading" className="eyebrow">
          Needs attention
        </h2>
        <span className="tile-icon">
          {count ? (
            <ArrowUpRight aria-hidden="true" />
          ) : (
            <Check aria-hidden="true" />
          )}
        </span>
      </div>
      {count === 0 ? (
        <div className="tile-figure">
          <span className="big-number">0</span>
          <span className="tile-note">All clear</span>
        </div>
      ) : (
        <>
          <span className="big-number">{count}</span>
          <ul className="attention-list" aria-label="Needs attention">
            {attention.map((a) => (
              <li key={a.inspection.id}>
                <InspectionLink
                  inspection={a.inspection}
                  tab={a.tab}
                  from={HERE}
                  className={`attention-link tone-${a.tone}`}
                >
                  <span className="attention-dot" aria-hidden="true" />
                  <span className="attention-text">
                    {titleOf(a.inspection)}
                    <span className="attention-reason"> · {a.reason}</span>
                  </span>
                </InspectionLink>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** Storage used, as a ring, and whether the iPad keeps the data. */
function StorageTile() {
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  useEffect(() => {
    void getStorageStatus().then(setStorage);
  }, []);
  const usage = storage?.usage;
  const quota = storage?.quota;
  const known = usage !== undefined && !!quota;
  const used = known ? Math.min(100, (usage / quota) * 100) : 0;
  const nearlyFull = known && used >= NEARLY_FULL * 100;
  const r = 30;
  const length = 2 * Math.PI * r;
  return (
    <section
      className={`tile tile-plain tile-storage${nearlyFull ? " tile-storage-full" : ""}`}
      aria-labelledby="storage-heading"
    >
      <svg viewBox="0 0 76 76" className="storage-ring" aria-hidden="true">
        <circle cx="38" cy="38" r={r} className="ring-track" />
        <circle
          cx="38"
          cy="38"
          r={r}
          className="ring-value"
          strokeDasharray={`${Math.max((used / 100) * length, 2)} ${length}`}
          transform="rotate(-90 38 38)"
        />
      </svg>
      <div className="list-row-main">
        <h2 id="storage-heading" className="eyebrow">
          Storage
        </h2>
        <span className="storage-figure">
          {known ? formatBytes(usage) : "Not reported"}
        </span>
        {known && <span className="muted small">of {formatBytes(quota)}</span>}
        {storage?.persisted !== undefined && (
          <span
            className={storage.persisted ? "storage-kept" : "storage-at-risk"}
          >
            {storage.persisted ? (
              <>
                <ShieldCheck aria-hidden="true" /> Kept by the iPad
              </>
            ) : (
              <>
                <ShieldAlert aria-hidden="true" /> May be cleared
              </>
            )}
          </span>
        )}
        {nearlyFull && (
          <p className="storage-warning" data-testid="storage-warning">
            Nearly full ({Math.round(used)}%). Back up and delete finished
            inspections in <Link to="/settings">Settings</Link>.
          </p>
        )}
      </div>
    </section>
  );
}
