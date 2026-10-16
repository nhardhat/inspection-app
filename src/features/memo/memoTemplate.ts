import { formatLongDate } from "../../lib/dates";

/**
 * Fixed memo wording that is template logic, not user-editable snippets
 * (SPEC section 4, docs/content/snippets.md "Rules"). Brand text (office
 * block, disclaimer, strapline) lives in src/brand/northrop.ts.
 */

export const SIGN_OFF = "Yours sincerely,";

export const DETAIL_LABELS = {
  siteVisitRequestedBy: "SITE VISIT REQUESTED BY",
  reasonForVisit: "REASON FOR VISIT:",
  inspector: "INSPECTOR:",
  sentVia: "SENT VIA",
} as const;

export const RECIPIENT_HEADINGS = {
  to: "To",
  copy: "Copy",
  company: "Company",
  attn: "Attn:",
} as const;

/** Part of a body paragraph; italic for the item inspected. */
export interface TextPart {
  text: string;
  italic?: boolean;
}

/**
 * Body paragraph 1 (SPEC section 4), with the item inspected in italics
 * (engineer, 2026-10-16).
 */
export function confirmationParts(itemInspected: string): TextPart[] {
  return [
    { text: "We confirm having inspected the " },
    { text: itemInspected, italic: true },
    { text: " as highlighted on the drawing attached." },
  ];
}

/** Body paragraph 1 as plain text. */
export function confirmationParagraph(itemInspected: string): string {
  return confirmationParts(itemInspected)
    .map((part) => part.text)
    .join("");
}

/**
 * The conditions lead-in: with one or more conditions the list follows
 * "Ok to proceed subject to the following:"; with none, "Ok to proceed."
 * With a photo line (an instruction needs photo confirmation; engineer,
 * 2026-10-16) it joins the lead-in: "Ok to proceed subject to the
 * following. Items marked * to be closed out with photos:".
 */
export function conditionsLeadIn(
  conditionCount: number,
  photoLine = "",
): string {
  if (conditionCount === 0) return "Ok to proceed.";
  const photo = photoLine.trim().replace(/[\s.:;]+$/, "");
  return photo
    ? `Ok to proceed subject to the following. ${photo}:`
    : "Ok to proceed subject to the following:";
}

/** "SIM-001 – Level 3 slab reinforcement" (SPEC section 4). */
export function referenceLine(
  reference: string,
  itemInspected: string,
): string {
  return itemInspected ? `${reference} – ${itemInspected}` : reference;
}

/** "2026-10-01" -> "1 October 2026". Other strings are shown as entered. */
export const formatMemoDate = formatLongDate;
