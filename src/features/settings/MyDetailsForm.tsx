import { useLiveQuery } from "dexie-react-hooks";
import { Signature, User } from "lucide-react";
import { useState } from "react";
import { northrop, officeFor } from "../../brand/northrop";
import { saveStateLabel, useAutosave } from "../../app/useAutosave";
import { db } from "../../db/db";
import { clearMySignature, setMySignature } from "../../db/signatures";
import { SETTINGS_ID, type SentVia, type Settings } from "../../db/types";
import { SignatureField } from "../signature/SignatureField";

type Details = Pick<
  Settings,
  "inspectorName" | "inspectorTitle" | "defaultSentVia" | "officeId"
>;

const SENT_VIA: SentVia[] = ["Aconex", "Email"];

/** Inspector details: prefill new inspections and the memo sign-off. */
export function MyDetailsForm() {
  // Settings are created on first run; show the form once they exist.
  const settings = useLiveQuery(() => db.settings.get(SETTINGS_ID), []);
  return settings ? <MyDetailsFields initial={settings} /> : null;
}

/** My signature, copied into each new memo. */
export function MySignature() {
  const settings = useLiveQuery(() => db.settings.get(SETTINGS_ID), []);
  if (!settings) return null;
  return (
    <section
      id="signature"
      className="settings-card"
      aria-labelledby="signature-heading"
    >
      <h2 id="signature-heading" className="card-title">
        <span className="card-icon">
          <Signature aria-hidden="true" />
        </span>
        Signature
      </h2>
      <p className="muted">
        Copied into each new memo, between &ldquo;Yours sincerely,&rdquo; and
        your name. Memos you&rsquo;ve already made keep theirs.
      </p>
      <SignatureField
        label="My signature"
        blobId={settings.signatureBlobId}
        onSave={(png) => setMySignature(db, png)}
        onRemove={() => clearMySignature(db)}
      />
    </section>
  );
}

/** Owns the field values after the first load so typing is never overwritten. */
function MyDetailsFields({ initial }: { initial: Details }) {
  const [values, setValues] = useState<Details>({
    inspectorName: initial.inspectorName,
    inspectorTitle: initial.inspectorTitle,
    defaultSentVia: initial.defaultSentVia,
    officeId: officeFor(initial.officeId).id,
  });
  const autosave = useAutosave<Partial<Details>>(
    async (patch) => {
      await db.settings.update(SETTINGS_ID, patch);
    },
    (a, b) => ({ ...a, ...b }),
  );

  const change = <K extends keyof Details>(key: K, value: Details[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    autosave.queue({ [key]: value });
  };

  return (
    <section
      id="my-details"
      className="settings-card"
      aria-labelledby="my-details-heading"
    >
      <div className="page-heading">
        <h2 id="my-details-heading" className="card-title">
          <span className="card-icon">
            <User aria-hidden="true" />
          </span>
          My details
        </h2>
        <span
          className="save-state"
          role="status"
          data-testid="settings-save-state"
        >
          {saveStateLabel(autosave.state)}
        </span>
      </div>
      <p className="muted">
        Used for new inspections and the memo sign-off. Your office&rsquo;s
        address goes on new memos.
      </p>
      <form
        className="form-grid"
        aria-label="My details"
        onSubmit={(e) => e.preventDefault()}
      >
        <label className="field">
          <span>Inspector name</span>
          <input
            name="inspectorName"
            value={values.inspectorName}
            autoCapitalize="words"
            autoComplete="name"
            onChange={(e) => change("inspectorName", e.target.value)}
            onBlur={() => void autosave.flush()}
          />
        </label>
        <label className="field">
          <span>Title</span>
          <input
            name="inspectorTitle"
            value={values.inspectorTitle}
            autoCapitalize="words"
            autoComplete="organization-title"
            onChange={(e) => change("inspectorTitle", e.target.value)}
            onBlur={() => void autosave.flush()}
          />
        </label>
        <label className="field">
          <span>Default "Sent via"</span>
          <select
            name="defaultSentVia"
            value={values.defaultSentVia}
            onChange={(e) =>
              change("defaultSentVia", e.target.value as SentVia)
            }
            onBlur={() => void autosave.flush()}
          >
            {SENT_VIA.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Office</span>
          <select
            name="officeId"
            value={values.officeId}
            onChange={(e) => change("officeId", e.target.value)}
            onBlur={() => void autosave.flush()}
          >
            {northrop.offices.map((office) => (
              <option key={office.id} value={office.id}>
                {office.name}
              </option>
            ))}
          </select>
        </label>
      </form>
    </section>
  );
}
