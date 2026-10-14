import { useEffect, useRef, useState } from "react";
import { db } from "../../../db/db";
import type { PDFDocumentProxy } from "../pdf/pdfjs";
import { diagnostics, recordError } from "./diagnostics";
import { closeDrawing } from "./pageDrawer";

/** PDFs kept open beyond the ones currently needed, most recent first. */
const KEEP_EXTRA = 2;

/**
 * Opens drawing PDFs only while their pages are on or near the screen, and
 * closes ones that haven't been needed recently, so a long inspection never
 * holds every drawing in memory at once.
 */
export function usePdfDocuments(
  needed: string[],
  blobIds: Map<string, string>,
): { docs: Map<string, PDFDocumentProxy>; errors: Map<string, string> } {
  const [docs, setDocs] = useState(() => new Map<string, PDFDocumentProxy>());
  const [errors, setErrors] = useState(() => new Map<string, string>());
  const loading = useRef(new Set<string>());
  const recent = useRef<string[]>([]);
  const open = useRef(new Map<string, PDFDocumentProxy>());
  const alive = useRef(true);
  const blobIdsRef = useRef(blobIds);
  useEffect(() => {
    blobIdsRef.current = blobIds;
  });

  const neededKey = [...needed].sort().join(",");

  useEffect(() => {
    const wanted = neededKey ? neededKey.split(",") : [];
    recent.current = [
      ...wanted,
      ...recent.current.filter((id) => !wanted.includes(id)),
    ];
    const keep = new Set(recent.current.slice(0, wanted.length + KEEP_EXTRA));

    // Close PDFs that fell out of the recent set.
    let changed = false;
    for (const [id, doc] of open.current) {
      if (!keep.has(id)) {
        void doc.loadingTask.destroy();
        closeDrawing(id);
        open.current.delete(id);
        changed = true;
      }
    }
    if (changed) setDocs(new Map(open.current));

    for (const id of wanted) {
      if (open.current.has(id) || loading.current.has(id)) continue;
      const blobId = blobIdsRef.current.get(id);
      if (!blobId) continue;
      loading.current.add(id);
      void (async () => {
        const started = performance.now();
        try {
          const stored = await db.blobs.get(blobId);
          if (!stored)
            throw new Error("The drawing's PDF is missing from this device.");
          const { loadPdf } = await import("../pdf/pdfjs");
          // pdf.js takes ownership of the buffer it is given, so pass a copy.
          const doc = await loadPdf(new Uint8Array(stored.data.slice(0)));
          if (!alive.current) {
            void doc.loadingTask.destroy();
            return;
          }
          diagnostics.pdfs.set(id, {
            ms: performance.now() - started,
            bytes: stored.data.byteLength,
          });
          open.current.set(id, doc);
          setDocs(new Map(open.current));
        } catch (e) {
          recordError("PDF open failed", e);
          setErrors((old) =>
            new Map(old).set(id, e instanceof Error ? e.message : String(e)),
          );
        } finally {
          loading.current.delete(id);
        }
      })();
    }
  }, [neededKey]);

  // Close everything when the document screen goes away.
  useEffect(() => {
    alive.current = true;
    const opened = open.current;
    return () => {
      alive.current = false;
      for (const [id, doc] of opened) {
        void doc.loadingTask.destroy();
        closeDrawing(id);
      }
      opened.clear();
    };
  }, []);

  return { docs, errors };
}
