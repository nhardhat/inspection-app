/**
 * Export filename `{jobNumber}-{reference}-A-{itemInspected}.pdf`, e.g.
 * "SY000001-SIM001-A-Level 3 slab.pdf" (engineer, 2026-10-16; the A is
 * always A). SPEC 7a. Spaces are kept; characters that break iOS Files,
 * Windows or email attachments go.
 */
export function memoFilename(
  jobNumber: string,
  reference: string,
  itemInspected: string,
): string {
  const job = fileSafe(jobNumber);
  const ref = fileSafe(reference);
  const parts = [
    job,
    ref,
    job || ref ? "A" : "",
    fileSafe(itemInspected),
  ].filter((part) => part.length > 0);
  const base = parts.join("-").slice(0, 120).trim() || "memo";
  return `${base}.pdf`;
}

/** Text safe in a file name, spaces kept (one at a time). */
function fileSafe(part: string): string {
  return (
    part
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      // Not allowed or trouble in Windows, iOS Files and email names.
      .replace(/[\\/:*?"<>|]+/g, " ")
      // Tabs, line breaks and other invisible characters too.
      .replace(/\p{Cc}+/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^[-.]+|[-.]+$/g, "")
  );
}

/** Makes text safe in a file name (iOS Files, Windows, email). */
export function sanitise(part: string): string {
  return part
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9.-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
}
