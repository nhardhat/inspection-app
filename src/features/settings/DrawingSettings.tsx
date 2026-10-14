import { PenLine } from "lucide-react";
import { updatePrefs, useMarkupPrefs } from "../markup/markupPrefs";

/** Settings: how the Pencil draws (kept on this device). */
export function DrawingSettings() {
  const prefs = useMarkupPrefs();
  return (
    <section
      id="drawing"
      className="settings-card"
      aria-labelledby="drawing-heading"
    >
      <h2 id="drawing-heading" className="card-title">
        <span className="card-icon">
          <PenLine aria-hidden="true" />
        </span>
        Drawing
      </h2>
      <label className="checkbox switch">
        <input
          type="checkbox"
          checked={prefs.predict}
          onChange={(e) =>
            updatePrefs((p) => {
              p.predict = e.target.checked;
            })
          }
        />
        <span>
          Pencil prediction
          <span className="muted small">
            {" "}
            Draws the line a moment ahead, toward where the iPad expects the tip
            to go, so it keeps up better. The saved line uses only where the
            Pencil actually went.
          </span>
        </span>
      </label>
    </section>
  );
}
