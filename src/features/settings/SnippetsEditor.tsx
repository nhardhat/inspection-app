import { useLiveQuery } from "dexie-react-hooks";
import { ChevronRight, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AutoGrowTextarea } from "../../app/AutoGrowTextarea";
import { ConfirmDialog } from "../../app/ConfirmDialog";
import { saveStateLabel, useAutosave } from "../../app/useAutosave";
import { db } from "../../db/db";
import { addSnippet, deleteSnippet, updateSnippet } from "../../db/snippets";
import type { Snippet, SnippetKind } from "../../db/types";

const GROUPS: {
  kind: SnippetKind;
  title: string;
  hint: string;
  /** One message only: no Add or Delete. */
  single?: boolean;
}[] = [
  {
    kind: "body",
    title: "Memo messages",
    hint: "The memo's second paragraph. Pick one per memo, then edit it there if needed.",
  },
  {
    kind: "condition",
    title: "Standard conditions",
    hint: "Ticked per memo; listed before the instructions. [letters] becomes the instruction letters, e.g. A–D.",
  },
  {
    kind: "heading",
    title: "Notes box heading",
    hint: "Heads the observations in each drawing page's notes box.",
  },
  {
    kind: "photoNote",
    title: "Photo confirmation line",
    hint: "Instructions needing photo confirmation are marked * in the memo and the notes box; this line is the last bullet of the memo's list when any is. Leave it empty for no line.",
    single: true,
  },
  {
    kind: "referDrawings",
    title: "Refer to drawings",
    hint: "With Refer to drawings on in a memo, this line replaces the instructions list. [letters] becomes the instruction letters, e.g. A–M.",
    single: true,
  },
];

/**
 * Settings: the prefilled messages (snippets) the memo and notes box use.
 * Each saves as you type; changes reach memos straight away, except a memo
 * message already chosen (the memo keeps its own copy of that text).
 */
export function SnippetsEditor() {
  const snippets = useLiveQuery(() => db.snippets.toArray(), []);
  const [deleting, setDeleting] = useState<Snippet | null>(null);
  // A message just added opens ready to type.
  const [added, setAdded] = useState<string | null>(null);
  if (!snippets) return null;

  return (
    <div className="snippets-editor">
      <p className="chip-row">
        {GROUPS.map((group) => (
          <a
            key={group.kind}
            className="chip chip-link"
            href={`#snippets-${group.kind}`}
            onClick={(e) => {
              e.preventDefault();
              document
                .getElementById(`snippets-${group.kind}`)
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          >
            {group.title}{" "}
            <strong>
              {snippets.filter((s) => s.kind === group.kind).length}
            </strong>
          </a>
        ))}
      </p>
      {GROUPS.map((group) => {
        const list = snippets.filter((s) => s.kind === group.kind);
        return (
          <section
            key={group.kind}
            id={`snippets-${group.kind}`}
            className="snippet-group"
            aria-label={group.title}
          >
            <h3>{group.title}</h3>
            <p className="muted">{group.hint}</p>
            {list.map((s) => (
              <SnippetRow
                // Remounts open once it is known to be the one just added.
                key={s.id === added ? `${s.id}:new` : s.id}
                snippet={s}
                startOpen={s.id === added}
                onDelete={group.single ? undefined : () => setDeleting(s)}
              />
            ))}
            {!group.single && (
              <p className="button-row">
                <button
                  type="button"
                  onClick={() =>
                    void addSnippet(db, group.kind).then((s) => setAdded(s.id))
                  }
                >
                  <Plus aria-hidden="true" /> Add
                </button>
              </p>
            )}
          </section>
        );
      })}
      <ConfirmDialog
        open={deleting !== null}
        title={`Delete "${deleting?.label ?? ""}"?`}
        confirmLabel="Delete"
        danger
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) void deleteSnippet(db, deleting.id);
          setDeleting(null);
        }}
      >
        <p>
          It won&rsquo;t be offered for new memos. Memos that already use a memo
          message keep their text; a deleted standard condition leaves every
          memo.
        </p>
      </ConfirmDialog>
    </div>
  );
}

/**
 * One message, folded to its name and the start of its text; tap to open
 * it for editing.
 */
function SnippetRow({
  snippet,
  startOpen,
  onDelete,
}: {
  snippet: Snippet;
  startOpen: boolean;
  /** Absent for a message that can't be deleted. */
  onDelete?: () => void;
}) {
  const [open, setOpen] = useState(startOpen);
  const row = useRef<HTMLDetailsElement>(null);
  // A message just added may sit anywhere in the list: bring it into view.
  useEffect(() => {
    if (startOpen) row.current?.scrollIntoView({ block: "center" });
  }, [startOpen]);
  const [label, setLabel] = useState(snippet.label);
  const [text, setText] = useState(snippet.text);
  const autosave = useAutosave<Partial<Pick<Snippet, "label" | "text">>>(
    (patch) => updateSnippet(db, snippet.id, patch),
    (a, b) => ({ ...a, ...b }),
  );
  return (
    <details
      ref={row}
      className="snippet-row"
      data-testid="snippet-row"
      data-new={startOpen || undefined}
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        <ChevronRight aria-hidden="true" className="summary-chevron" />
        <span className="snippet-name">{label || "Untitled"}</span>
        {!open && <span className="snippet-preview muted">{text}</span>}
        <span className="muted small">{saveStateLabel(autosave.state)}</span>
      </summary>
      <label className="field">
        <span>Name</span>
        <input
          value={label}
          aria-label={`Name of ${snippet.label}`}
          onChange={(e) => {
            setLabel(e.target.value);
            autosave.queue({ label: e.target.value });
          }}
          onBlur={() => void autosave.flush()}
        />
      </label>
      <label className="field">
        <span>Text</span>
        <AutoGrowTextarea
          rows={snippet.kind === "heading" ? 1 : 3}
          value={text}
          aria-label={`Text of ${snippet.label}`}
          autoCapitalize="sentences"
          onChange={(e) => {
            setText(e.target.value);
            autosave.queue({ text: e.target.value });
          }}
          onBlur={() => void autosave.flush()}
        />
      </label>
      {onDelete && (
        <p className="button-row">
          <button type="button" className="danger-outline" onClick={onDelete}>
            <Trash2 aria-hidden="true" /> Delete
          </button>
        </p>
      )}
    </details>
  );
}
