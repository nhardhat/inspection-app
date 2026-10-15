/**
 * Parses docs/content/snippets.md (the editable source) into Snippet records.
 *
 * Sections are recognised by their "## " heading; bullets have the form
 *   - Label: "Text"
 * The "Rules" section is template logic, not snippets, and is skipped.
 */

export type SnippetKind = "body" | "condition" | "heading" | "photoNote";

export interface SnippetRecord {
  id: string;
  kind: SnippetKind;
  label: string;
  text: string;
}

const SECTION_KINDS: [prefix: string, kind: SnippetKind][] = [
  ["Body messages", "body"],
  ["Standard conditions", "condition"],
  ["Observations box heading", "heading"],
  ["Photo confirmation line", "photoNote"],
];

const BULLET = /^- (.+?): "(.+)"\s*$/;

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function parseSnippets(markdown: string): SnippetRecord[] {
  const snippets: SnippetRecord[] = [];
  let kind: SnippetKind | null = null;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("## ")) {
      const title = line.slice(3);
      kind =
        SECTION_KINDS.find(([prefix]) => title.startsWith(prefix))?.[1] ?? null;
      continue;
    }
    if (!kind || !line.startsWith("- ")) continue;

    const match = BULLET.exec(line);
    if (!match) {
      throw new Error(`Unrecognised snippet line: ${line}`);
    }
    const [, label, text] = match;
    snippets.push({ id: `${kind}-${slug(label)}`, kind, label, text });
  }

  const ids = new Set(snippets.map((s) => s.id));
  if (ids.size !== snippets.length) {
    throw new Error("Duplicate snippet labels within a section");
  }
  return snippets;
}
