import type { InspectionDb } from "./schema";
import type { Snippet, SnippetKind } from "./types";

const NEW_LABELS: Record<SnippetKind, string> = {
  body: "New message",
  condition: "New condition",
  heading: "New heading",
  photoNote: "Photo confirmation line",
  referDrawings: "Refer to drawings",
  inspectionType: "New inspection type",
};

export async function addSnippet(
  db: InspectionDb,
  kind: SnippetKind,
): Promise<Snippet> {
  const snippet: Snippet = {
    id: crypto.randomUUID(),
    kind,
    label: NEW_LABELS[kind],
    text: "",
  };
  await db.snippets.add(snippet);
  return snippet;
}

export async function updateSnippet(
  db: InspectionDb,
  id: string,
  patch: Partial<Pick<Snippet, "label" | "text">>,
): Promise<void> {
  await db.snippets.update(id, patch);
}

export async function deleteSnippet(
  db: InspectionDb,
  id: string,
): Promise<void> {
  await db.snippets.delete(id);
}
