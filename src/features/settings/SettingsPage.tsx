import { useLiveQuery } from "dexie-react-hooks";
import {
  Database,
  Info,
  MessageSquareText,
  PenLine,
  ShieldAlert,
  ShieldCheck,
  Signature,
  User,
  Wrench,
} from "lucide-react";
import { useEffect, useState } from "react";
import { appCommit, appVersion } from "../../app/version";
import { db } from "../../db/db";
import {
  formatBytes,
  getStorageStatus,
  type StorageStatus,
} from "../../db/storage";
import type { SnippetKind } from "../../db/types";
import { DrawingSettings } from "./DrawingSettings";
import { MyDetailsForm, MySignature } from "./MyDetailsForm";
import { SnippetsEditor } from "./SnippetsEditor";
import { BackupAll } from "../backup/BackupAll";
import { AboutCard } from "./AboutCard";
import { DeveloperSettings } from "./DeveloperSettings";

const KINDS: [SnippetKind, string][] = [
  ["body", "body"],
  ["condition", "condition"],
  ["heading", "heading"],
  ["photoNote", "photo note"],
];

const SECTIONS = [
  { id: "my-details", label: "My details", Icon: User },
  { id: "signature", label: "Signature", Icon: Signature },
  {
    id: "prefilled-messages",
    label: "Prefilled messages",
    Icon: MessageSquareText,
  },
  { id: "drawing", label: "Drawing", Icon: PenLine },
  { id: "storage", label: "Storage and backup", Icon: Database },
  { id: "about", label: "About", Icon: Info },
  { id: "developer", label: "Developer", Icon: Wrench },
];

/**
 * Settings (SPEC section 12): a list of sections beside the cards in
 * landscape (a row of chips in portrait); tapping one jumps to it.
 */
export function SettingsPage() {
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const [current, setCurrent] = useState("my-details");
  const snippets = useLiveQuery(() => db.snippets.toArray(), []);

  useEffect(() => {
    void getStorageStatus().then(setStorage);
  }, []);

  const used =
    storage?.usage !== undefined && storage.quota
      ? Math.min(100, (storage.usage / storage.quota) * 100)
      : null;

  return (
    <section className="settings-page">
      <h1>Settings</h1>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map(({ id, label, Icon }) => (
            <a
              key={id}
              href={`#${id}`}
              aria-current={current === id ? "true" : undefined}
              onClick={(e) => {
                // Hash routing owns the URL hash: scroll instead of linking.
                e.preventDefault();
                setCurrent(id);
                document
                  .getElementById(id)
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              <Icon aria-hidden="true" /> {label}
            </a>
          ))}
          <p className="app-version">
            Version {appVersion} ({appCommit})
          </p>
        </nav>

        <div className="settings-cards">
          <MyDetailsForm />
          <MySignature />

          <section
            id="prefilled-messages"
            className="settings-card"
            aria-labelledby="prefilled-heading"
          >
            <h2 id="prefilled-heading" className="card-title">
              <span className="card-icon">
                <MessageSquareText aria-hidden="true" />
              </span>
              Prefilled messages
            </h2>
            <p className="muted" data-testid="snippet-count">
              {snippets === undefined
                ? "Loading…"
                : `${snippets.length} snippets (${KINDS.map(
                    ([kind, name]) =>
                      `${snippets.filter((s) => s.kind === kind).length} ${name}`,
                  ).join(", ")})`}
            </p>
            <SnippetsEditor />
          </section>

          <DrawingSettings />

          <section
            id="storage"
            className="settings-card"
            aria-labelledby="storage-heading"
          >
            <h2 id="storage-heading" className="card-title">
              <span className="card-icon">
                <Database aria-hidden="true" />
              </span>
              Storage and backup
            </h2>
            <div
              className="notice keep-app-warning"
              data-testid="keep-app-warning"
            >
              <p>
                <strong>Don't remove Hardhat from the Home Screen.</strong>{" "}
                Removing it deletes every inspection, drawing and photo stored
                in it. Back up first (Back up all, below), and keep the files
                somewhere safe.
              </p>
            </div>
            <div className="storage-line">
              <span data-testid="storage-used">
                {storage === null
                  ? "Checking…"
                  : storage.usage === undefined || storage.quota === undefined
                    ? "Not reported on this device"
                    : `${formatBytes(storage.usage)} used of ${formatBytes(storage.quota)}`}
              </span>
              <span
                data-testid="storage-persistent"
                className={
                  storage?.persisted ? "storage-kept" : "storage-at-risk"
                }
              >
                {storage === null ? (
                  "Checking…"
                ) : storage.persisted === undefined ? (
                  "Not reported on this device"
                ) : storage.persisted ? (
                  <>
                    <ShieldCheck aria-hidden="true" /> Kept by the iPad
                  </>
                ) : (
                  <>
                    <ShieldAlert aria-hidden="true" /> May be cleared if space
                    runs low
                  </>
                )}
              </span>
            </div>
            {used !== null && (
              <div
                className="meter"
                role="meter"
                aria-label="Storage used"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(used)}
              >
                <span style={{ width: `${Math.max(used, 1)}%` }} />
              </div>
            )}
            <BackupAll />
          </section>
          <AboutCard />
          <DeveloperSettings />
        </div>
      </div>
    </section>
  );
}
