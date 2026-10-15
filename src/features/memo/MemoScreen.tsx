import { useLiveQuery } from "dexie-react-hooks";
import { Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { NotFound } from "../../app/NotFound";
import { AutoGrowTextarea } from "../../app/AutoGrowTextarea";
import { saveStateLabel, useAutosave } from "../../app/useAutosave";
import { useRowDrag } from "../../app/useRowDrag";
import { db } from "../../db/db";
import { formatLongDate } from "../../lib/dates";
import { getMemo, updateMemo, type MemoPatch } from "../../db/memos";
import {
  contactKey,
  loadJobInspection,
  rememberContacts,
  saveJob,
  type JobPatch,
} from "../../db/projects";
import { setMemoSignature } from "../../db/signatures";
import {
  SETTINGS_ID,
  type JobInspection,
  type Memo,
  type Recipient,
  type SentVia,
} from "../../db/types";
import {
  JobDetailsForm,
  type JobDetailsValues,
} from "../inspections/JobDetailsForm";
import {
  mergePatches,
  toPatch,
  toValues,
  withValues,
} from "../inspections/jobDetails";
import {
  buildMemoPdfInput,
  photoLine,
  conditionTicked,
  defaultSalutation,
  defaultSiteVisitRequestedBy,
  letterRange,
  memoInstructions,
} from "./buildMemo";
import { InspectionHeader } from "../inspections/InspectionTabs";
import { inspectionTitle } from "../inspections/inspectionTitle";
import { ExportCard } from "../export/ExportCard";
import { PhotosSection } from "../photos/PhotosSection";
import { SignatureField } from "../signature/SignatureField";
import { CreateMemo } from "./CreateMemo";
import { MemoPreview } from "./MemoPreview";
import { conditionsLeadIn, confirmationParagraph } from "./memoTemplate";

const MAX_RECIPIENTS = 10;
const SENT_VIA: SentVia[] = ["Aconex", "Email"];

/**
 * Site memo tab: Create memo until the inspection has one, then the
 * editor.
 */
export function MemoScreen() {
  const { id = "" } = useParams();
  const found = useLiveQuery(
    async () => ({
      inspection: (await loadJobInspection(db, id)) ?? null,
      memoId: (await getMemo(db, id))?.id ?? null,
    }),
    [id],
  );
  if (!found) return null;
  const { inspection, memoId } = found;
  if (!inspection) return <NotFound what="Inspection" />;
  return (
    <>
      {memoId ? (
        <MemoEditorFor key={memoId} inspectionId={id} />
      ) : (
        <section className="memo-screen">
          <InspectionHeader
            inspectionId={id}
            title={inspectionTitle(inspection)}
            current="memo"
          />
          <CreateMemo inspection={inspection} />
        </section>
      )}
      <PhotosSection inspectionId={id} jobNumber={inspection.jobNumber} />
      <ExportCard inspectionId={id} />
    </>
  );
}

type Load =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "ready"; inspection: JobInspection; memo: Memo };

/**
 * The Site Instruction Memo editor (SPEC section 4): the form, with a live
 * preview of the exported page. Saves as you type. Job details are the
 * project's and the inspection's own, so editing them here changes them
 * everywhere.
 */
function MemoEditorFor({ inspectionId }: { inspectionId: string }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  // Loaded once: the form then owns its values, so typing is never overwritten.
  const [job, setJob] = useState<JobDetailsValues | null>(null);
  const [memo, setMemo] = useState<Memo | null>(null);
  // Job details fold to a one-line summary; Edit opens the fields.
  const [editingJob, setEditingJob] = useState(false);
  const jobSave = useAutosave<JobPatch>(
    (patch) => saveJob(db, inspectionId, patch),
    mergePatches,
  );
  const memoSave = useAutosave<MemoPatch>(
    (patch) => (memo ? updateMemo(db, memo.id, patch) : Promise.resolve()),
    (a, b) => ({ ...a, ...b }),
  );
  const items = useLiveQuery(
    () => db.items.where("inspectionId").equals(inspectionId).toArray(),
    [inspectionId],
  );
  const snippets = useLiveQuery(() => db.snippets.toArray(), []);
  const contacts = useLiveQuery(async () => {
    const inspection = await db.inspections.get(inspectionId);
    return inspection?.projectId
      ? ((await db.projects.get(inspection.projectId))?.contacts ?? [])
      : [];
  }, [inspectionId]);
  const mySignatureId = useLiveQuery(
    async () => (await db.settings.get(SETTINGS_ID))?.signatureBlobId ?? null,
    [],
  );
  const signatureId =
    memo?.includeSignature && memo.signatureBlobId
      ? memo.signatureBlobId
      : null;
  const signature = useLiveQuery(
    async () => (signatureId ? await db.blobs.get(signatureId) : undefined),
    [signatureId],
  );

  useEffect(() => {
    let current = true;
    void Promise.all([
      loadJobInspection(db, inspectionId),
      getMemo(db, inspectionId),
    ]).then(([inspection, found]) => {
      if (!current) return;
      if (!inspection || !found) return setLoad({ status: "missing" });
      setLoad({ status: "ready", inspection, memo: found });
      setJob(toValues(inspection));
      setMemo(found);
    });
    return () => {
      current = false;
    };
  }, [inspectionId]);

  // Drag ≡ to reorder the recipients (their order in the memo).
  const recipientDrag = useRowDrag(
    (memo?.recipients ?? []).map((_, i) => String(i)),
    (order) =>
      memo &&
      patch({ recipients: order.map((i) => memo.recipients[Number(i)]) }),
  );

  if (load.status === "loading") return null;
  if (load.status === "missing" || !job || !memo || !items || !snippets) {
    if (load.status !== "missing") return null;
    return <NotFound what="Memo" />;
  }

  async function setSignature(source: Uint8Array | "mine" | null) {
    if (!memo) return;
    // Save typing first: setMemoSignature writes the memo too.
    await memoSave.flush();
    const signatureBlobId = await setMemoSignature(db, memo.id, source);
    setMemo((m) =>
      m
        ? {
            ...m,
            signatureBlobId,
            includeSignature: source ? true : m.includeSignature,
          }
        : m,
    );
  }

  function patch(p: MemoPatch) {
    setMemo((m) => (m ? { ...m, ...p } : m));
    memoSave.queue(p);
  }

  const inspection = withValues(load.inspection, job);
  const conditionSnippets = snippets.filter((s) => s.kind === "condition");
  const bodySnippets = snippets.filter((s) => s.kind === "body");
  const instructions = memoInstructions(items);
  const letters = letterRange(instructions.map((i) => i.letter));
  const input = buildMemoPdfInput(
    memo,
    inspection,
    items,
    conditionSnippets,
    photoLine(snippets),
  );
  const saveState =
    jobSave.state === "error" || memoSave.state === "error"
      ? "error"
      : jobSave.state === "saving" || memoSave.state === "saving"
        ? "saving"
        : memoSave.state === "saved" || jobSave.state === "saved"
          ? "saved"
          : "idle";

  // Recipients typed in are remembered as the project's contacts.
  const projectId = load.inspection.projectId;
  const rememberRecipient = (i: number) => {
    void memoSave.flush();
    const r = memo.recipients[i];
    if (projectId && r) void rememberContacts(db, projectId, [r]);
  };
  const usedKeys = new Set(memo.recipients.map(contactKey));
  const unusedContacts = (contacts ?? []).filter(
    (c) => !usedKeys.has(contactKey(c)),
  );

  const setRecipient = (i: number, change: Partial<Recipient>) =>
    patch({
      recipients: memo.recipients.map((r, j) =>
        j === i ? { ...r, ...change } : r,
      ),
    });

  return (
    <section className="memo-screen">
      <InspectionHeader
        inspectionId={inspectionId}
        title={inspectionTitle(job)}
        current="memo"
        status={
          <span
            className="save-state"
            role="status"
            data-testid="memo-save-state"
          >
            {saveStateLabel(saveState)}
          </span>
        }
      />

      <div className="memo-layout">
        <div className="memo-form">
          <section className="card memo-section" aria-labelledby="memo-title">
            <h2 id="memo-title" className="memo-title">
              Site Instruction Memo · {memo.reference}
            </h2>
            <label className="field">
              <span>Reference</span>
              <input
                value={memo.reference}
                autoCapitalize="characters"
                onChange={(e) => patch({ reference: e.target.value })}
                onBlur={() => void memoSave.flush()}
              />
            </label>

            <div className="job-summary">
              <div className="list-row-main">
                <span className="eyebrow">Job details</span>
                <span className="job-summary-text">{jobSummary(job)}</span>
              </div>
              <button
                type="button"
                aria-expanded={editingJob}
                onClick={() => {
                  if (editingJob) void jobSave.flush();
                  setEditingJob((open) => !open);
                }}
              >
                {editingJob ? (
                  "Done"
                ) : (
                  <>
                    <Pencil aria-hidden="true" /> Edit job details
                  </>
                )}
              </button>
            </div>
            {editingJob && (
              <>
                <p className="muted">
                  Shared with the inspection and its project: changing them here
                  changes them there too (job number, name, client and address
                  change for every inspection in the project).
                </p>
                <JobDetailsForm
                  values={job}
                  onChange={(key, value) => {
                    setJob((v) => (v ? { ...v, [key]: value } : v));
                    jobSave.queue(toPatch(key, value));
                  }}
                  onBlur={() => void jobSave.flush()}
                />
              </>
            )}
          </section>

          <section
            className="card memo-section"
            aria-labelledby="recipients-heading"
          >
            <h2 id="recipients-heading">Recipients</h2>
            <table className="memo-recipients" aria-label="Recipients">
              <thead>
                <tr>
                  <th>
                    <span className="sr-only">Reorder</span>
                  </th>
                  <th>Company</th>
                  <th>Attn</th>
                  <th>Send as</th>
                  <th>
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {memo.recipients.map((r, i) => (
                  <tr
                    key={i}
                    ref={recipientDrag.rowRef(String(i))}
                    className={
                      recipientDrag.draggingId === String(i)
                        ? "reorder-row-dragged"
                        : undefined
                    }
                    style={{
                      transform: `translateY(${recipientDrag.shift(String(i))}px)`,
                      transition:
                        recipientDrag.draggingId === null ||
                        recipientDrag.draggingId === String(i)
                          ? "none"
                          : undefined,
                    }}
                    onBlur={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node))
                        rememberRecipient(i);
                    }}
                  >
                    <td>
                      {memo.recipients.length > 1 && (
                        <button
                          type="button"
                          className="drag-handle"
                          aria-label={`Reorder recipient ${i + 1}`}
                          title="Drag to reorder"
                          {...recipientDrag.handleProps(String(i))}
                        >
                          ≡
                        </button>
                      )}
                    </td>
                    <td>
                      <input
                        aria-label={`Recipient ${i + 1} company`}
                        value={r.company}
                        autoCapitalize="words"
                        onChange={(e) =>
                          setRecipient(i, { company: e.target.value })
                        }
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`Recipient ${i + 1} attention`}
                        value={r.attn}
                        autoCapitalize="words"
                        onChange={(e) =>
                          setRecipient(i, { attn: e.target.value })
                        }
                      />
                    </td>
                    <td>
                      {/* To or Copy: two checkboxes drawn as one switch. */}
                      <span className="pill-pair">
                        <label className="pill-check">
                          <input
                            type="checkbox"
                            aria-label={`Recipient ${i + 1} to`}
                            checked={r.to}
                            onChange={(e) =>
                              setRecipient(i, {
                                to: e.target.checked,
                                copy: e.target.checked ? false : r.copy,
                              })
                            }
                          />
                          <span aria-hidden="true">To</span>
                        </label>
                        <label className="pill-check">
                          <input
                            type="checkbox"
                            aria-label={`Recipient ${i + 1} copy`}
                            checked={r.copy}
                            onChange={(e) =>
                              setRecipient(i, {
                                copy: e.target.checked,
                                to: e.target.checked ? false : r.to,
                              })
                            }
                          />
                          <span aria-hidden="true">Copy</span>
                        </label>
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="icon-button quiet"
                        aria-label={`Remove recipient ${i + 1}`}
                        onClick={() =>
                          patch({
                            recipients: memo.recipients.filter(
                              (_, j) => j !== i,
                            ),
                          })
                        }
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="button-row">
              <button
                type="button"
                disabled={memo.recipients.length >= MAX_RECIPIENTS}
                onClick={() =>
                  patch({
                    recipients: [
                      ...memo.recipients,
                      { company: "", attn: "", to: false, copy: true },
                    ],
                  })
                }
              >
                Add recipient
              </button>
              {unusedContacts.length > 0 &&
                memo.recipients.length < MAX_RECIPIENTS && (
                  <select
                    aria-label="Add from contacts"
                    value=""
                    onChange={(e) => {
                      const contact = unusedContacts.find(
                        (c) => c.id === e.target.value,
                      );
                      if (!contact) return;
                      const to = !memo.recipients.some((r) => r.to);
                      patch({
                        recipients: [
                          ...memo.recipients,
                          {
                            company: contact.company,
                            attn: contact.attn,
                            to,
                            copy: !to,
                          },
                        ],
                      });
                    }}
                  >
                    <option value="">Add from contacts…</option>
                    {unusedContacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {[c.attn, c.company].filter(Boolean).join(", ")}
                      </option>
                    ))}
                  </select>
                )}
            </p>
            {!memo.recipients.some((r) => r.to) && (
              <p className="notice" data-testid="no-to-recipient">
                Mark at least one recipient as To.
              </p>
            )}
          </section>

          <section
            className="card memo-section"
            aria-labelledby="visit-heading"
          >
            <h2 id="visit-heading">Visit</h2>
            <DefaultedField
              label="Site visit requested by"
              value={memo.siteVisitRequestedBy}
              fallback={defaultSiteVisitRequestedBy(inspection.client)}
              onChange={(v) => patch({ siteVisitRequestedBy: v })}
              onBlur={() => void memoSave.flush()}
            />
            <DefaultedField
              label="Reason for visit"
              value={memo.reasonForVisit}
              fallback={inspection.itemInspected}
              onChange={(v) => patch({ reasonForVisit: v })}
              onBlur={() => void memoSave.flush()}
            />
            <label className="field">
              <span>Sent via</span>
              <select
                value={memo.sentVia}
                onChange={(e) => patch({ sentVia: e.target.value as SentVia })}
              >
                {SENT_VIA.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>

            <label className="checkbox switch">
              <input
                type="checkbox"
                checked={memo.includeSignature}
                onChange={(e) => patch({ includeSignature: e.target.checked })}
              />
              Include signature
            </label>
            <SignatureField
              label="Signature on this memo"
              blobId={memo.signatureBlobId}
              onSave={(png) => setSignature(png)}
              onRemove={() => setSignature(null)}
              extra={
                mySignatureId && (
                  <button
                    type="button"
                    onClick={() => void setSignature("mine")}
                  >
                    Use my saved signature
                  </button>
                )
              }
            />
          </section>

          <section
            className="card memo-section"
            aria-labelledby="letter-heading"
          >
            <h2 id="letter-heading">Letter</h2>
            <DefaultedField
              label="Salutation"
              value={memo.salutation}
              fallback={defaultSalutation(memo.recipients)}
              onChange={(v) => patch({ salutation: v })}
              onBlur={() => void memoSave.flush()}
            />
            <p className="memo-fixed" data-testid="memo-paragraph-1">
              {confirmationParagraph(inspection.itemInspected)}
            </p>
            <label className="field">
              <span>Message</span>
              <select
                aria-label="Prefilled message"
                value={memo.bodySnippetId ?? ""}
                onChange={(e) => {
                  const chosen = bodySnippets.find(
                    (s) => s.id === e.target.value,
                  );
                  if (chosen)
                    patch({ bodySnippetId: chosen.id, bodyText: chosen.text });
                }}
              >
                {memo.bodySnippetId === null && (
                  <option value="">Choose…</option>
                )}
                {bodySnippets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Message text (for this memo)</span>
              <AutoGrowTextarea
                rows={4}
                value={memo.bodyText}
                autoCapitalize="sentences"
                onChange={(e) => patch({ bodyText: e.target.value })}
                onBlur={() => void memoSave.flush()}
              />
            </label>
          </section>

          <section
            className="card memo-section"
            aria-labelledby="conditions-heading"
          >
            <h2 id="conditions-heading">Conditions</h2>
            <p className="memo-fixed" data-testid="memo-lead-in">
              {conditionsLeadIn(input.conditions.length)}
            </p>
            <fieldset className="memo-conditions">
              <legend>Standard conditions</legend>
              {conditionSnippets.map((s) => (
                <label key={s.id} className="checkbox">
                  <input
                    type="checkbox"
                    checked={conditionTicked(memo, s.id, instructions)}
                    onChange={(e) =>
                      patch({
                        conditionChoices: {
                          ...memo.conditionChoices,
                          [s.id]: e.target.checked,
                        },
                      })
                    }
                  />
                  {s.text.replace(/\[letters\]/g, letters || "[letters]")}
                </label>
              ))}
            </fieldset>
            {instructions.length === 0 ? (
              <p className="muted">
                No instructions yet, so the memo says &ldquo;Ok to
                proceed.&rdquo;
              </p>
            ) : (
              <ol className="memo-instructions" aria-label="Instructions">
                {instructions.map((item) => {
                  const override = memo.itemOverrides[item.id];
                  return (
                    <li key={item.id}>
                      <label className="field">
                        <span>
                          {item.letter}.{" "}
                          {item.requiresPhotoConfirmation && (
                            <span
                              className="memo-photo-mark"
                              data-testid="memo-photo-mark"
                            >
                              * photo confirmation{" "}
                            </span>
                          )}
                          {override !== undefined && (
                            <span className="muted">
                              (reworded for this memo)
                            </span>
                          )}
                        </span>
                        <AutoGrowTextarea
                          rows={2}
                          aria-label={`Instruction ${item.letter} in the memo`}
                          value={override ?? item.text}
                          onChange={(e) =>
                            patch({
                              itemOverrides: {
                                ...memo.itemOverrides,
                                [item.id]: e.target.value,
                              },
                            })
                          }
                          onBlur={() => void memoSave.flush()}
                        />
                      </label>
                      {override !== undefined && (
                        <button
                          type="button"
                          onClick={() => {
                            const rest = { ...memo.itemOverrides };
                            delete rest[item.id];
                            patch({ itemOverrides: rest });
                          }}
                        >
                          Use item text
                        </button>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
            {/* The list's last bullet when any instruction needs photos. */}
            {instructions.some((i) => i.requiresPhotoConfirmation) &&
              photoLine(snippets) && (
                <p className="memo-photo-line" data-testid="memo-photo-line">
                  {photoLine(snippets)}
                </p>
              )}
            <p className="muted">
              Instructions come from the pins; add or change them on the
              drawings. Rewording one here changes only the memo.
            </p>
          </section>

          <section
            className="card memo-section"
            aria-labelledby="signoff-heading"
          >
            <h2 id="signoff-heading">Sign-off</h2>
            <label className="field">
              <span>Name</span>
              <input
                value={memo.signOffName}
                autoCapitalize="words"
                onChange={(e) => patch({ signOffName: e.target.value })}
                onBlur={() => void memoSave.flush()}
              />
            </label>
            <label className="field">
              <span>Title</span>
              <input
                value={memo.signOffTitle}
                autoCapitalize="words"
                onChange={(e) => patch({ signOffTitle: e.target.value })}
                onBlur={() => void memoSave.flush()}
              />
            </label>
          </section>
        </div>

        <MemoPreview
          input={input}
          signature={signatureId ? signature : undefined}
        />
      </div>
    </section>
  );
}

/** One line: job, client, date and inspector. */
function jobSummary(job: JobDetailsValues): string {
  return (
    [
      [job.jobNumber, job.jobName].filter((x) => x.trim()).join(" – "),
      [job.clientName, job.clientCompany].filter((x) => x.trim()).join(", "),
      formatLongDate(job.date),
      job.inspector,
    ]
      .filter((x) => x.trim())
      .join(" · ") || "No job details yet"
  );
}

/**
 * A field with a default worked out from other data (e.g. the salutation
 * from the first To recipient). Shows the default until changed; Reset
 * goes back to it.
 */
function DefaultedField({
  label,
  value,
  fallback,
  onChange,
  onBlur,
}: {
  label: string;
  value: string | null;
  fallback: string;
  onChange: (value: string | null) => void;
  onBlur: () => void;
}) {
  return (
    <div className="defaulted-field">
      <label className="field">
        <span>{label}</span>
        <input
          value={value ?? fallback}
          autoCapitalize="sentences"
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
        />
      </label>
      {/* Outside the label, so the field's name stays just the label. */}
      {value !== null && value !== fallback && (
        <button
          type="button"
          className="link-button"
          aria-label={`Reset ${label.toLowerCase()}`}
          onClick={() => onChange(null)}
        >
          Reset
        </button>
      )}
    </div>
  );
}
