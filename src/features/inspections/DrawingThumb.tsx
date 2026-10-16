import { useLiveQuery } from "dexie-react-hooks";
import { Files } from "lucide-react";
import { useEffect, useState } from "react";
import { db } from "../../db/db";
import { listDrawings } from "../../db/drawings";
import type { ItemKind } from "../../db/types";
import { itemSpots } from "../items/spots";

interface Target {
  pdfBlobId: string;
  page: number;
  /** The PDF page that position shows (pages can be duplicated). */
  source: number;
  /** Pins on that page, normalised 0..1. */
  pins: { id: string; kind: ItemKind; letter: string; x: number; y: number }[];
}

/** Where the rendered page sits in the tile (CSS px). */
interface Placement {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** How far the thumbnail zooms in past "fit width", so pins read. */
const ZOOM = 1.5;

/**
 * A preview of an inspection's drawings for the home screen: the page with
 * the most pins (else the first page), zoomed in around its pins, with the
 * pins drawn on top. Drawn once with pdf.js and released when it leaves.
 */
export function DrawingThumb({ inspectionId }: { inspectionId: string }) {
  // The element the page is drawn into (a callback ref, so the size
  // observer starts once it exists).
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [failed, setFailed] = useState(false);
  // The tile's size; the page is redrawn when it changes (e.g. rotation).
  const [size, setSize] = useState("");
  useEffect(() => {
    const box = host;
    if (!box) return;
    let timer = 0;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(
        () => setSize(`${box.clientWidth}x${box.clientHeight}`),
        150,
      );
    });
    observer.observe(box);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [host]);

  const target = useLiveQuery(async (): Promise<Target | null> => {
    const drawings = await listDrawings(db, inspectionId);
    const first = drawings[0];
    if (!first) return null;
    const items = await db.items
      .where("inspectionId")
      .equals(inspectionId)
      .toArray();
    // Every pin, copies included (a copy shows its item's letter).
    const spots = items.flatMap((item) =>
      itemSpots(item).map((spot) => ({ spot, item })),
    );
    const counts = new Map<string, number>();
    for (const { spot } of spots) {
      const key = `${spot.drawingId}:${spot.page}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    let best = { drawingId: first.id, page: 1, count: 0 };
    for (const [key, count] of counts) {
      if (count <= best.count) continue;
      const [drawingId, page] = key.split(":");
      best = { drawingId, page: Number(page), count };
    }
    const drawing = drawings.find((d) => d.id === best.drawingId) ?? first;
    // A page moved in from another drawing shows that drawing's PDF.
    const from = drawing.pages?.[best.page - 1]?.from;
    const pdf = drawings.find((d) => d.id === from) ?? drawing;
    return {
      pdfBlobId: pdf.pdfBlobId,
      page: best.page,
      source: drawing.pages?.[best.page - 1]?.source ?? best.page,
      pins: spots
        .filter(
          ({ spot }) =>
            spot.drawingId === drawing.id && spot.page === best.page,
        )
        .map(({ spot, item }) => ({
          id: spot.key,
          kind: item.kind,
          letter: item.letter,
          x: spot.x,
          y: spot.y,
        })),
    };
  }, [inspectionId]);

  // Centre of the pins (or of the page), which the zoomed preview frames.
  const pins = target?.pins ?? [];
  const cx = pins.length
    ? pins.reduce((sum, p) => sum + p.x, 0) / pins.length
    : 0.5;
  const cy = pins.length
    ? pins.reduce((sum, p) => sum + p.y, 0) / pins.length
    : 0.4;
  const blobId = target?.pdfBlobId;
  const pageNumber = target?.source;

  useEffect(() => {
    if (!blobId || !pageNumber || !size) return;
    let current = true;
    let canvas: HTMLCanvasElement | null = null;
    void (async () => {
      try {
        const stored = await db.blobs.get(blobId);
        const box = host;
        if (!stored || !box || !current) return;
        const { loadPdf } = await import("../drawings/pdf/pdfjs");
        const pdf = await loadPdf(new Uint8Array(stored.data.slice(0)));
        try {
          const page = await pdf.getPage(pageNumber);
          const base = page.getViewport({ scale: 1 });
          const width = box.clientWidth * ZOOM;
          const height = (width / base.width) * base.height;
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          const viewport = page.getViewport({
            scale: (width / base.width) * dpr,
          });
          canvas = document.createElement("canvas");
          canvas.width = Math.round(viewport.width);
          canvas.height = Math.round(viewport.height);
          await page.render({ canvas, viewport }).promise;
          if (!current) return;
          const clamp = (v: number, min: number, max: number) =>
            Math.min(max, Math.max(min, v));
          const left = clamp(
            box.clientWidth / 2 - cx * width,
            box.clientWidth - width,
            0,
          );
          const top = clamp(
            box.clientHeight / 2 - cy * height,
            Math.min(0, box.clientHeight - height),
            0,
          );
          Object.assign(canvas.style, {
            left: `${left}px`,
            top: `${top}px`,
            width: `${width}px`,
            height: `${height}px`,
          });
          canvas.className = "thumb-page";
          box.replaceChildren(canvas);
          setPlacement({ left, top, width, height });
        } finally {
          await pdf.loadingTask.destroy();
        }
      } catch (e) {
        console.error("Drawing preview failed", e);
        if (current) setFailed(true);
      }
    })();
    return () => {
      current = false;
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
    };
    // Redraw when the page, the pins' centre or the tile's size changes.
  }, [host, blobId, pageNumber, cx, cy, size]);

  if (target === null || failed)
    return (
      <div className="drawing-thumb drawing-thumb-empty" aria-hidden="true">
        <Files />
        <span>{failed ? "Preview unavailable" : "No drawings yet"}</span>
      </div>
    );

  return (
    <div className="drawing-thumb" aria-hidden="true">
      <div ref={setHost} className="thumb-host" />
      {placement && (
        <div
          className="thumb-pins"
          style={{
            left: placement.left,
            top: placement.top,
            width: placement.width,
            height: placement.height,
          }}
        >
          {pins.map((p) => (
            <span
              key={p.id}
              className={`thumb-pin${p.kind === "observation" ? " thumb-pin-observation" : ""}`}
              style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
            >
              {p.letter}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
