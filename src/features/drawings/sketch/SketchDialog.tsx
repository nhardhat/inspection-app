import { useState } from "react";
import { ConfirmDialog } from "../../../app/ConfirmDialog";
import {
  SKETCH_SCALES,
  SKETCH_SIZES,
  type SketchOrientation,
  type SketchScale,
  type SketchSize,
} from "./sketchPdf";
import type { SketchSheet } from "./sketchPages";

/**
 * Picks a sketch page's sheet: A4 to A1, portrait or landscape, and the
 * scale shown in its title strip (engineer, 2026-10-20).
 */
export function SketchDialog({
  open,
  title,
  confirmLabel,
  initial,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  confirmLabel: string;
  initial: SketchSheet;
  onConfirm: (sheet: SketchSheet) => void;
  onCancel: () => void;
}) {
  const [sheet, setSheet] = useState(initial);
  return (
    <ConfirmDialog
      open={open}
      title={title}
      confirmLabel={confirmLabel}
      onConfirm={() => onConfirm(sheet)}
      onCancel={onCancel}
    >
      <div className="sketch-dialog">
        <label className="field">
          <span>Sheet</span>
          <select
            value={sheet.size}
            onChange={(e) =>
              setSheet({ ...sheet, size: e.target.value as SketchSize })
            }
          >
            {SKETCH_SIZES.map((size) => (
              <option key={size}>{size}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Orientation</span>
          <select
            value={sheet.orientation}
            onChange={(e) =>
              setSheet({
                ...sheet,
                orientation: e.target.value as SketchOrientation,
              })
            }
          >
            <option value="landscape">Landscape</option>
            <option value="portrait">Portrait</option>
          </select>
        </label>
        <label className="field">
          <span>Scale</span>
          <select
            value={sheet.scale}
            onChange={(e) =>
              setSheet({ ...sheet, scale: e.target.value as SketchScale })
            }
          >
            {SKETCH_SCALES.map((scale) => (
              <option key={scale}>{scale}</option>
            ))}
          </select>
        </label>
      </div>
    </ConfirmDialog>
  );
}
