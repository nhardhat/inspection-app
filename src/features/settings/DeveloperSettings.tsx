import { Lock, Wrench } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { updatePrefs, useMarkupPrefs } from "../markup/markupPrefs";
import {
  isDeveloperUnlocked,
  lockDeveloper,
  unlockDeveloper,
} from "./developer";

/**
 * Settings: developer tools (diagnostics and the drawing lab), behind a
 * password until the app is closed (developer.ts).
 */
export function DeveloperSettings() {
  const prefs = useMarkupPrefs();
  const [unlocked, setUnlocked] = useState(isDeveloperUnlocked);
  const [password, setPassword] = useState("");
  const [wrong, setWrong] = useState(false);

  async function unlock() {
    const ok = await unlockDeveloper(password);
    setWrong(!ok);
    setPassword("");
    if (ok) setUnlocked(true);
  }

  return (
    <section
      id="developer"
      className="settings-card"
      aria-labelledby="developer-heading"
    >
      <h2 id="developer-heading" className="card-title">
        <span className="card-icon">
          <Wrench aria-hidden="true" />
        </span>
        Developer
      </h2>
      {!unlocked ? (
        <form
          className="developer-unlock"
          onSubmit={(e) => {
            e.preventDefault();
            void unlock();
          }}
        >
          <p className="muted small">
            Tools for testing the app. Locked with a password.
          </p>
          <label>
            Password
            <input
              type="password"
              value={password}
              autoComplete="off"
              autoCapitalize="characters"
              onChange={(e) => {
                setPassword(e.target.value);
                setWrong(false);
              }}
            />
          </label>
          <button type="submit" disabled={!password.trim()}>
            Unlock
          </button>
          {wrong && (
            <p role="alert" className="error">
              Wrong password.
            </p>
          )}
        </form>
      ) : (
        <>
          <label className="checkbox switch">
            <input
              type="checkbox"
              checked={prefs.diagnostics}
              onChange={(e) =>
                updatePrefs((p) => {
                  p.diagnostics = e.target.checked;
                })
              }
            />
            <span>
              Show diagnostics
              <span className="muted small">
                {" "}
                A panel over the drawings with how sharply each page was drawn,
                memory, scrolling and errors, to screenshot or copy when
                something looks wrong. Page numbers only, never drawing names.
              </span>
            </span>
          </label>
          <p className="small">
            <Link to="/lab/drawing">Drawing lab</Link>{" "}
            <span className="muted">
              (times one page drawn on the main thread and in the background)
            </span>
          </p>
          <p className="button-row">
            <button
              type="button"
              className="quiet"
              onClick={() => {
                lockDeveloper();
                setUnlocked(false);
              }}
            >
              <Lock aria-hidden="true" /> Lock
            </button>
          </p>
        </>
      )}
    </section>
  );
}
