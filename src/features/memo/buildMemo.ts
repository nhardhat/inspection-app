/**
 * Turns a memo, its inspection and the inspection's items into what the
 * memo page shows (SPEC section 4). Pure, so the editor's preview and the
 * exported PDF are built the same way.
 */
import type {
  Client,
  JobInspection,
  Item,
  Memo,
  MemoFields,
  Recipient,
  Snippet,
} from "../../db/types";
import { indexForLetter } from "../items/letters";
import { confirmationParts } from "./memoTemplate";
import type { MemoPdfInput } from "./pdf/renderMemoPdf";

export const COMPLETE_ITEMS_ID = "condition-complete-listed-items";

/**
 * Photo confirmation (engineer, 2026-10-16): an instruction needing it is
 * marked * (memo and notes box), and when any is this line joins the
 * conditions lead-in ("Ok to proceed subject to the following. Items marked
 * * to be closed out with photos:"). A Settings message; this is the text
 * when none is stored.
 */
export const DEFAULT_PHOTO_LINE = "Items marked * to be closed out with photos";

/**
 * Earlier starter texts, replaced once on update: the note after each
 * instruction (until 2026-10-16), then the first wording of the line.
 */
export const OLD_PHOTO_TEXTS = [
  "(provide photos confirming completion before proceeding)",
  "Items marked * are to be closed out with photos confirming completion prior to proceeding.",
];

/** The marker after an instruction that needs photo confirmation. */
export const PHOTO_MARK = "*";

/** The Refer to drawings line when no message for it is stored. */
export const DEFAULT_REFER_LINE =
  "Complete the instructions marked on the attached drawings (items [letters]).";

/** The Refer to drawings line, from Settings. */
export function referLine(snippets: Pick<Snippet, "kind" | "text">[]): string {
  const stored = snippets.find((s) => s.kind === "referDrawings");
  return stored?.text.trim() || DEFAULT_REFER_LINE;
}

/** The line explaining the *, from Settings (empty: no line). */
export function photoLine(snippets: Pick<Snippet, "kind" | "text">[]): string {
  const stored = snippets.find((s) => s.kind === "photoNote");
  return stored ? stored.text.trim() : DEFAULT_PHOTO_LINE;
}

/** Instructions in letter order (only instructions appear in the memo). */
export function memoInstructions(items: Item[]): Item[] {
  return items
    .filter((item) => item.kind === "instruction")
    .sort((a, b) => indexForLetter(a.letter) - indexForLetter(b.letter));
}

/** ["A", "B", "C"] -> "A–C"; one letter -> "A". Letters have no gaps. */
export function letterRange(letters: string[]): string {
  const sorted = [...letters].sort(
    (a, b) => indexForLetter(a) - indexForLetter(b),
  );
  if (sorted.length === 0) return "";
  if (sorted.length === 1) return sorted[0];
  return `${sorted[0]}–${sorted[sorted.length - 1]}`;
}

/** "Dear Alex," from the first name of the first "To" recipient's Attn. */
export function defaultSalutation(recipients: Recipient[]): string {
  const first = recipients.find((r) => r.to && r.attn.trim());
  const name = first?.attn.trim().split(/\s+/)[0];
  return name ? `Dear ${name},` : "";
}

/** "Alex Example, Example Builders Pty Ltd". */
export function defaultSiteVisitRequestedBy(client: Client): string {
  return [client.name, client.company]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(", ");
}

/**
 * Whether a standard condition is ticked. Unless the engineer chose,
 * "Complete items [letters] listed below." is on when there are
 * instructions; others (the photo condition too: each instruction needing
 * photos carries its own note) start off.
 */
export function conditionTicked(
  memo: Pick<Memo, "conditionChoices">,
  snippetId: string,
  instructions: Item[],
): boolean {
  const chosen = memo.conditionChoices[snippetId];
  if (chosen !== undefined) return chosen;
  if (snippetId === COMPLETE_ITEMS_ID) return instructions.length > 0;
  return false;
}

export interface MemoCondition {
  /** Snippet id (standard condition), item id (instruction) or "refer-line". */
  key: string;
  kind: "standard" | "instruction" | "refer";
  text: string;
  /** Instructions: reworded for this memo rather than the item's text. */
  reworded?: boolean;
}

/**
 * The bulleted conditions: ticked standard conditions first ("[letters]"
 * filled in, e.g. "A–D"), then each instruction as "A. text", reworded
 * where the engineer changed it for this memo, marked * when it needs
 * photo confirmation (the body explains the *). With Refer to drawings on,
 * one line ("[letters]" filled in) replaces the instructions.
 */
export function memoConditions(
  memo: Pick<Memo, "conditionChoices" | "itemOverrides" | "referToDrawings">,
  items: Item[],
  conditionSnippets: Snippet[],
  refer = DEFAULT_REFER_LINE,
): MemoCondition[] {
  const instructions = memoInstructions(items);
  const letters = letterRange(instructions.map((item) => item.letter));
  const standard = conditionSnippets
    .filter((s) => conditionTicked(memo, s.id, instructions))
    .map<MemoCondition>((s) => ({
      key: s.id,
      kind: "standard",
      text: s.text.replace(/\[letters\]/g, letters).trim(),
    }));
  const lines = instructions.map<MemoCondition>((item) => {
    const override = memo.itemOverrides[item.id];
    const mark = item.requiresPhotoConfirmation ? ` ${PHOTO_MARK}` : "";
    return {
      key: item.id,
      kind: "instruction",
      text: `${item.letter}. ${(override ?? item.text).trim()}${mark}`.trim(),
      reworded: override !== undefined,
    };
  });
  const listed: MemoCondition[] =
    memo.referToDrawings && instructions.length > 0
      ? [
          {
            key: "refer-line",
            kind: "refer",
            text: refer.replace(/\[letters\]/g, letters).trim(),
          },
        ]
      : lines;
  return [...standard, ...listed];
}

/** Memo fields for the page: job details from the inspection, the rest from the memo. */
export function memoFields(memo: Memo, inspection: JobInspection): MemoFields {
  return {
    clientName: inspection.client.name,
    clientCompany: inspection.client.company,
    address1: inspection.client.address1,
    address2: inspection.client.address2,
    date: inspection.date,
    jobNumber: inspection.jobNumber,
    jobName: inspection.jobName,
    recipients: memo.recipients,
    siteVisitRequestedBy:
      memo.siteVisitRequestedBy ??
      defaultSiteVisitRequestedBy(inspection.client),
    reasonForVisit: memo.reasonForVisit ?? inspection.itemInspected,
    inspector: inspection.inspector,
    sentVia: memo.sentVia,
    salutation: memo.salutation ?? defaultSalutation(memo.recipients),
    itemInspected: inspection.itemInspected,
    signOffName: memo.signOffName,
    signOffTitle: memo.signOffTitle,
  };
}

/**
 * The photo line for the lead-in when any instruction needs photo
 * confirmation (else nothing).
 */
export function photoLineFor(items: Item[], line = DEFAULT_PHOTO_LINE) {
  return line &&
    memoInstructions(items).some((item) => item.requiresPhotoConfirmation)
    ? line
    : "";
}

/** Everything the memo PDF needs. */
export function buildMemoPdfInput(
  memo: Memo,
  inspection: JobInspection,
  items: Item[],
  conditionSnippets: Snippet[],
  line = DEFAULT_PHOTO_LINE,
  refer = DEFAULT_REFER_LINE,
): MemoPdfInput {
  return {
    reference: memo.reference,
    fields: memoFields(memo, inspection),
    bodyParagraphs: [
      confirmationParts(inspection.itemInspected),
      memo.bodyText.trim(),
    ].filter((p) => p.length > 0),
    conditions: memoConditions(memo, items, conditionSnippets, refer).map(
      (c) => c.text,
    ),
    photoLine: photoLineFor(items, line),
  };
}
