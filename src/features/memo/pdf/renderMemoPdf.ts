import fontkit from "@pdf-lib/fontkit";
import {
  PDFDocument,
  rgb,
  type Color,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import { northrop } from "../../../brand/northrop";
import type { MemoFields, Recipient } from "../../../db/types";
import {
  DETAIL_LABELS,
  RECIPIENT_HEADINGS,
  SIGN_OFF,
  conditionsLeadIn,
  formatMemoDate,
  referenceLine,
} from "../memoTemplate";
import type { TextPart } from "../memoTemplate";
import { toEncodable, wrapRuns, wrapText, type Run } from "./text";

/** Everything the memo page shows that varies per job. */
export interface MemoPdfInput {
  reference: string;
  fields: MemoFields;
  /**
   * Paragraphs after the salutation (confirmation, then body message);
   * a paragraph can mix italic parts (the item inspected).
   */
  bodyParagraphs: (string | TextPart[])[];
  /** Bulleted conditions. None gives "Ok to proceed." and no list. */
  conditions: string[];
  /** Joins the lead-in when an instruction needs photos (else empty). */
  photoLine?: string;
}

/** Signature image (PNG), printed between the sign-off and the name. */
export type MemoSignature = Uint8Array;

export type FontKey = keyof typeof northrop.assets.fonts;

/** Font and image bytes, loaded by the caller so rendering stays pure. */
export interface MemoAssets {
  fonts: Record<FontKey, Uint8Array>;
  wordmarkCream: Uint8Array;
  icon: Uint8Array;
}

/*
 * Layout in PDF points, measured from Word's export of the sample
 * (docs/reference/Northrop_sample_report.pdf). Vertical values are distances
 * from the top of the page; text positions are baselines.
 */
const PAGE_W = northrop.page.width;
const PAGE_H = northrop.page.height;

const SIDEBAR = { right: 169, top: 27.6, bottom: 786.2, radius: 47 };
const WORDMARK = { x: 25.9, top: 47.3, width: 116.25 };
const SIDEBAR_TITLE = { x: 26.6, baseline: 195.5, size: 9 };
const OFFICE = { x: 27.8, baseline: 682.7, pitch: 10.1, size: 6.96 };
const FOOTER = {
  iconX: 28.35,
  iconBottom: 25.6,
  iconSize: 11.25,
  textX: 49.7,
  textBottom: 27.6,
  textSize: 5.04,
  dotSize: 6.96,
  pageNumberRight: 560.5,
  pageNumberBottom: 29,
  pageNumberSize: 6,
};

const LEFT = 184.3;
/** Tables run to here (they sit wider than the text, as in the sample). */
const RIGHT = 546;
/** Text stops at the 72 pt right margin. */
const TEXT_RIGHT = 523.3;
const CONTENT_W = TEXT_RIGHT - LEFT;
/** Lowest baseline allowed before flowing onto a new page. */
const BOTTOM = 770;
/** First baseline / top edge on continuation pages. */
const CONTINUATION_BASELINE = 52.7;
const CONTINUATION_TOP = 42.5;

const HEADER = {
  leftWidth: 175,
  rightX: 368.7,
  baseline: 52.7,
  pitch: 14,
  rightPitch: 12.9,
};

const RECIPIENTS = {
  minTop: 170,
  headerHeight: 23.5,
  headerBaseline: 13.7,
  headerSize: 11,
  rowHeight: 20.4,
  columns: [184.3, 219.3, 256.6, 390.5, 546],
  textInset: 5.9,
  box: 6.6,
};

const DETAILS = {
  gapAbove: 22,
  labelRight: 255.8,
  textInset: 5.2,
  labelSize: 6.96,
  labelPitch: 10.1,
  rowHeight: 22.8,
  extraLabelLine: 11.6,
  extraValueLine: 12,
};

const BODY = {
  size: 9,
  pitch: 12.95,
  firstGap: 31.3,
  paragraphGap: 16.9,
  bulletGap: 18.5,
  bulletX: 204.7,
  bulletTextX: 220.4,
  signOffGap: 33.8,
  nameGap: 38.1,
  titleGap: 16.9,
  /** Signature: height, and gaps from the sign-off baseline and to the name. */
  signatureHeight: 40,
  signatureMaxWidth: 170,
  signatureGapAbove: 8,
  signatureNameGap: 14,
};

const DISCLAIMER = { gap: 34, size: 6.96, pitch: 10.1 };

const RULE_WIDTH = 0.75;

function hex(colour: string): Color {
  const n = parseInt(colour.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const RED = hex(northrop.colours.red);
const CREAM = hex(northrop.colours.cream);
const MAROON = hex(northrop.colours.maroon);
const GREY = hex(northrop.colours.grey);
const RULE = hex(northrop.colours.rule);
const MUTED = hex(northrop.colours.muted);

export type MemoFonts = Record<FontKey, PDFFont>;
type Fonts = MemoFonts;

class MemoWriter {
  readonly pages: PDFPage[] = [];
  page!: PDFPage;
  /** Last baseline or block bottom drawn on the current page (from top). */
  cursor = 0;

  readonly doc: PDFDocument;
  readonly fonts: Fonts;
  readonly wordmark: PDFImage;
  readonly icon: PDFImage;

  constructor(
    doc: PDFDocument,
    fonts: Fonts,
    wordmark: PDFImage,
    icon: PDFImage,
  ) {
    this.doc = doc;
    this.fonts = fonts;
    this.wordmark = wordmark;
    this.icon = icon;
  }

  addPage() {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.pages.push(this.page);
    this.drawSidebar(this.pages.length === 1);
    this.cursor = CONTINUATION_TOP;
  }

  /** Next baseline `gap` below the cursor, flowing to a new page if needed. */
  baseline(gap: number, reserveBelow = 0): number {
    let next = this.cursor + gap;
    if (next + reserveBelow > BOTTOM) {
      this.addPage();
      next = CONTINUATION_BASELINE;
    }
    this.cursor = next;
    return next;
  }

  /** Top edge of a block `gap` below the cursor, flowing if it won't fit. */
  block(gap: number, height: number): number {
    let top = this.cursor + gap;
    if (top + height > BOTTOM + 2) {
      this.addPage();
      top = CONTINUATION_TOP;
    }
    this.cursor = top + height;
    return top;
  }

  text(
    value: string,
    x: number,
    baseline: number,
    font: PDFFont,
    size: number,
    color: Color = GREY,
  ) {
    const safe = toEncodable(value, font);
    if (!safe) return;
    this.page.drawText(safe, { x, y: PAGE_H - baseline, font, size, color });
  }

  runs(line: Run[], x: number, baseline: number, size: number, color: Color) {
    let cursorX = x;
    for (const run of line) {
      this.text(run.text, cursorX, baseline, run.font, size, color);
      cursorX += run.font.widthOfTextAtSize(run.text, size);
    }
  }

  wrap(value: string, font: PDFFont, size: number, width: number): string[] {
    return wrapText(toEncodable(value, font), font, size, width);
  }

  rect(x: number, top: number, width: number, height: number, color: Color) {
    this.page.drawRectangle({
      x,
      y: PAGE_H - top - height,
      width,
      height,
      color,
    });
  }

  hLine(x1: number, x2: number, top: number) {
    this.page.drawLine({
      start: { x: x1, y: PAGE_H - top },
      end: { x: x2, y: PAGE_H - top },
      thickness: RULE_WIDTH,
      color: RULE,
    });
  }

  vLine(x: number, top: number, bottom: number) {
    this.page.drawLine({
      start: { x, y: PAGE_H - top },
      end: { x, y: PAGE_H - bottom },
      thickness: RULE_WIDTH,
      color: RULE,
    });
  }

  drawSidebar(first: boolean) {
    const { right, top, bottom, radius: r } = SIDEBAR;
    // Rounded on the right only; the left edge bleeds off the page.
    const path = [
      `M -1 ${top}`,
      `H ${right - r}`,
      `A ${r} ${r} 0 0 1 ${right} ${top + r}`,
      `V ${bottom - r}`,
      `A ${r} ${r} 0 0 1 ${right - r} ${bottom}`,
      `H -1 Z`,
    ].join(" ");
    this.page.drawSvgPath(path, { x: 0, y: PAGE_H, color: RED });

    if (!first) return;
    const height =
      (WORDMARK.width * this.wordmark.height) / this.wordmark.width;
    this.page.drawImage(this.wordmark, {
      x: WORDMARK.x,
      y: PAGE_H - WORDMARK.top - height,
      width: WORDMARK.width,
      height,
    });
    this.text(
      northrop.memoTitle,
      SIDEBAR_TITLE.x,
      SIDEBAR_TITLE.baseline,
      this.fonts.bold,
      SIDEBAR_TITLE.size,
      CREAM,
    );
    northrop.officeBlock.forEach((line, i) => {
      this.text(
        line,
        OFFICE.x,
        OFFICE.baseline + i * OFFICE.pitch,
        this.fonts.regular,
        OFFICE.size,
        CREAM,
      );
    });
  }

  drawFooters() {
    this.pages.forEach((page, index) =>
      drawFooter(page, index + 1, this.fonts, this.icon),
    );
  }
}

/**
 * The memo's footer: the red roundel, the strapline and the page number.
 * Also used on the photo appendix pages of the export pack.
 */
export function drawFooter(
  page: PDFPage,
  number: number,
  fonts: MemoFonts,
  icon: PDFImage,
) {
  const { regular } = fonts;
  const f = FOOTER;
  page.drawImage(icon, {
    x: f.iconX,
    y: f.iconBottom,
    width: f.iconSize,
    height: f.iconSize,
  });
  const space = regular.widthOfTextAtSize(" ", f.textSize);
  let x = f.textX;
  northrop.strapline.forEach((part, i) => {
    if (i > 0) {
      x += space;
      page.drawText("·", {
        x,
        y: f.textBottom - 1,
        font: regular,
        size: f.dotSize,
        color: GREY,
      });
      x += regular.widthOfTextAtSize("·", f.dotSize) + space;
    }
    page.drawText(part, {
      x,
      y: f.textBottom,
      font: regular,
      size: f.textSize,
      color: GREY,
    });
    x += regular.widthOfTextAtSize(part, f.textSize);
  });
  const label = String(number);
  page.drawText(label, {
    x: f.pageNumberRight - regular.widthOfTextAtSize(label, f.pageNumberSize),
    y: f.pageNumberBottom,
    font: regular,
    size: f.pageNumberSize,
    color: GREY,
  });
}

function drawHeader(w: MemoWriter, input: MemoPdfInput): number {
  const { regular, semiBold } = w.fonts;
  const { fields } = input;

  const left: [string, number][] = [
    [fields.clientName, 8],
    [fields.clientCompany, 9],
    [fields.address1, 8],
    [fields.address2, 8],
  ];
  let baseline = HEADER.baseline - HEADER.pitch;
  for (const [value, size] of left) {
    const lines = w.wrap(value, regular, size, HEADER.leftWidth);
    for (const line of lines.length ? lines : [""]) {
      baseline += HEADER.pitch;
      w.text(line, LEFT, baseline, regular, size);
    }
  }
  const leftBottom = baseline;

  const rightWidth = TEXT_RIGHT - HEADER.rightX;
  w.text(
    formatMemoDate(fields.date),
    HEADER.rightX,
    HEADER.baseline,
    regular,
    8,
  );
  // Blank line between the date and the job block, as in the sample.
  baseline = HEADER.baseline + 24.2 - HEADER.rightPitch;
  const right: [string, PDFFont][] = [
    [fields.jobNumber, regular],
    [fields.jobName, semiBold],
    [referenceLine(input.reference, fields.itemInspected), semiBold],
  ];
  for (const [value, font] of right) {
    for (const line of w.wrap(value, font, 9, rightWidth)) {
      baseline += HEADER.rightPitch;
      w.text(line, HEADER.rightX, baseline, font, 9);
    }
  }
  return Math.max(leftBottom, baseline);
}

function drawRecipients(w: MemoWriter, recipients: Recipient[], top: number) {
  const { regular } = w.fonts;
  const r = RECIPIENTS;
  const [c0, c1, c2, c3, c4] = r.columns;
  const companyWidth = c3 - c2 - 2 * r.textInset;
  const attnWidth = c4 - c3 - 2 * r.textInset;

  // Heading row.
  w.cursor = top;
  const headTop = w.block(0, r.headerHeight);
  w.rect(c0, headTop, c4 - c0, r.headerHeight, CREAM);
  const headBaseline = headTop + r.headerBaseline;
  const centred = (label: string, from: number, to: number) =>
    from + (to - from - regular.widthOfTextAtSize(label, r.headerSize)) / 2;
  const h = RECIPIENT_HEADINGS;
  w.text(
    h.to,
    centred(h.to, c0, c1),
    headBaseline,
    regular,
    r.headerSize,
    MAROON,
  );
  w.text(
    h.copy,
    centred(h.copy, c1, c2),
    headBaseline,
    regular,
    r.headerSize,
    MAROON,
  );
  w.text(
    h.company,
    c2 + r.textInset,
    headBaseline,
    regular,
    r.headerSize,
    MAROON,
  );
  w.text(h.attn, c3 + r.textInset, headBaseline, regular, r.headerSize, MAROON);
  w.hLine(c0, c4, headTop);
  w.hLine(c0, c4, headTop + r.headerHeight);
  let segmentTop = headTop;

  for (const recipient of recipients) {
    const company = w.wrap(recipient.company, regular, 9, companyWidth);
    const attn = w.wrap(recipient.attn, regular, 9, attnWidth);
    const lines = Math.max(1, company.length, attn.length);
    const height = r.rowHeight + (lines - 1) * 11.5;
    const pageBefore = w.page;
    const rowTop = w.block(0, height);
    if (w.page !== pageBefore) {
      // Rows carried onto a new page get a top edge of their own.
      segmentTop = rowTop;
      w.hLine(c0, c4, rowTop);
    }

    drawCheckbox(w, (c0 + c1) / 2, rowTop + r.rowHeight / 2, recipient.to);
    drawCheckbox(w, (c1 + c2) / 2, rowTop + r.rowHeight / 2, recipient.copy);
    company.forEach((line, i) =>
      w.text(line, c2 + r.textInset, rowTop + 13.6 + i * 11.5, regular, 9),
    );
    attn.forEach((line, i) =>
      w.text(line, c3 + r.textInset, rowTop + 13.6 + i * 11.5, regular, 9),
    );
    w.hLine(c0, c4, rowTop + height);
    for (const x of [c1, c2, c3]) w.vLine(x, segmentTop, rowTop + height);
    segmentTop = rowTop + height;
  }
  if (recipients.length === 0) {
    for (const x of [c1, c2, c3]) w.vLine(x, headTop, headTop + r.headerHeight);
  }
}

function drawCheckbox(w: MemoWriter, cx: number, cy: number, checked: boolean) {
  const s = RECIPIENTS.box;
  const x = cx - s / 2;
  const top = cy - s / 2;
  w.page.drawRectangle({
    x,
    y: PAGE_H - top - s,
    width: s,
    height: s,
    borderColor: GREY,
    borderWidth: 0.5,
  });
  if (!checked) return;
  const inset = 1.3;
  const line = (x1: number, y1: number, x2: number, y2: number) =>
    w.page.drawLine({
      start: { x: x1, y: PAGE_H - y1 },
      end: { x: x2, y: PAGE_H - y2 },
      thickness: 0.6,
      color: GREY,
    });
  line(x + inset, top + inset, x + s - inset, top + s - inset);
  line(x + s - inset, top + inset, x + inset, top + s - inset);
}

function drawDetails(w: MemoWriter, fields: MemoFields) {
  const { regular, semiBold } = w.fonts;
  const d = DETAILS;
  const labelWidth = d.labelRight - LEFT - 2 * d.textInset;
  const valueX = d.labelRight + d.textInset;
  const valueWidth = RIGHT - valueX - d.textInset;
  const rows: [string, string][] = [
    [DETAIL_LABELS.siteVisitRequestedBy, fields.siteVisitRequestedBy],
    [DETAIL_LABELS.reasonForVisit, fields.reasonForVisit],
    [DETAIL_LABELS.inspector, fields.inspector],
    [DETAIL_LABELS.sentVia, fields.sentVia],
  ];

  let gap = d.gapAbove;
  for (const [label, value] of rows) {
    const labelLines = w.wrap(label, semiBold, d.labelSize, labelWidth);
    const valueLines = w.wrap(value, regular, 9, valueWidth);
    const height =
      d.rowHeight +
      Math.max(
        d.extraLabelLine * (labelLines.length - 1),
        d.extraValueLine * (Math.max(1, valueLines.length) - 1),
      );
    const top = w.block(gap, height);
    gap = 0;

    w.rect(LEFT, top, d.labelRight - LEFT, height, CREAM);
    w.hLine(LEFT, RIGHT, top);
    w.hLine(LEFT, RIGHT, top + height);
    w.vLine(d.labelRight, top, top + height);

    // Vertically centre each block on its cap height.
    const labelBlock =
      (labelLines.length - 1) * d.labelPitch + d.labelSize * 0.7;
    let baseline = top + (height - labelBlock) / 2 + d.labelSize * 0.7;
    for (const line of labelLines) {
      w.text(line, LEFT + d.textInset, baseline, semiBold, d.labelSize, MAROON);
      baseline += d.labelPitch;
    }
    const valueBlock = (valueLines.length - 1) * d.extraValueLine + 9 * 0.7;
    baseline = top + (height - valueBlock) / 2 + 9 * 0.7;
    for (const line of valueLines) {
      w.text(line, valueX, baseline, regular, 9);
      baseline += d.extraValueLine;
    }
  }
}

function drawParagraph(w: MemoWriter, text: string | TextPart[], gap: number) {
  const { regular, italic } = w.fonts;
  if (typeof text === "string") {
    const lines = w.wrap(text, regular, BODY.size, CONTENT_W);
    lines.forEach((line, i) => {
      const baseline = w.baseline(i === 0 ? gap : BODY.pitch);
      w.text(line, LEFT, baseline, regular, BODY.size);
    });
    return;
  }
  const runs: Run[] = text.map((part) => {
    const font = part.italic ? italic : regular;
    return { text: toEncodable(part.text, font), font };
  });
  wrapRuns(runs, BODY.size, CONTENT_W).forEach((line, i) => {
    const baseline = w.baseline(i === 0 ? gap : BODY.pitch);
    w.runs(line, LEFT, baseline, BODY.size, GREY);
  });
}

function drawBody(
  w: MemoWriter,
  input: MemoPdfInput,
  signature: PDFImage | null,
) {
  const { regular, bold } = w.fonts;
  const { fields } = input;

  drawParagraph(w, fields.salutation, BODY.firstGap);
  for (const paragraph of input.bodyParagraphs) {
    drawParagraph(w, paragraph, BODY.paragraphGap);
  }
  drawParagraph(
    w,
    conditionsLeadIn(input.conditions.length, input.photoLine),
    BODY.paragraphGap,
  );

  const bulletWidth = TEXT_RIGHT - BODY.bulletTextX;
  for (const condition of input.conditions) {
    const lines = w.wrap(condition, regular, BODY.size, bulletWidth);
    lines.forEach((line, i) => {
      const baseline = w.baseline(i === 0 ? BODY.bulletGap : BODY.pitch);
      if (i === 0) {
        w.page.drawCircle({
          x: BODY.bulletX,
          y: PAGE_H - baseline + 3,
          size: 1.6,
          color: GREY,
        });
      }
      w.text(line, BODY.bulletTextX, baseline, regular, BODY.size);
    });
  }

  // Keep the sign-off, signature, name and title together.
  const titleLines = w.wrap(fields.signOffTitle, regular, BODY.size, CONTENT_W);
  const nameLines = w.wrap(fields.signOffName, bold, BODY.size, CONTENT_W);
  // The signature keeps its shape: 40 pt tall unless that makes it too wide.
  const sig = signature
    ? signature.scale(
        Math.min(
          BODY.signatureHeight / signature.height,
          BODY.signatureMaxWidth / signature.width,
        ),
      )
    : null;
  const nameGap = sig
    ? BODY.signatureGapAbove +
      BODY.signatureHeight +
      BODY.signatureNameGap +
      BODY.size * 0.7
    : BODY.nameGap;
  const reserve =
    nameGap +
    (nameLines.length - 1) * BODY.pitch +
    BODY.titleGap +
    (titleLines.length - 1) * BODY.pitch;
  let baseline = w.baseline(BODY.signOffGap, reserve);
  w.text(SIGN_OFF, LEFT, baseline, regular, BODY.size);
  if (signature && sig) {
    // Bottom-aligned in its 40 pt band, so a short, wide one sits on the line.
    const bottom = baseline + BODY.signatureGapAbove + BODY.signatureHeight;
    w.page.drawImage(signature, {
      x: LEFT,
      y: PAGE_H - bottom,
      width: sig.width,
      height: sig.height,
    });
  }
  nameLines.forEach((line, i) => {
    baseline = w.baseline(i === 0 ? nameGap : BODY.pitch);
    w.text(line, LEFT, baseline, bold, BODY.size);
  });
  titleLines.forEach((line, i) => {
    baseline = w.baseline(i === 0 ? BODY.titleGap : BODY.pitch);
    w.text(line, LEFT, baseline, regular, BODY.size);
  });
}

function drawDisclaimer(w: MemoWriter) {
  const { boldItalic, italic } = w.fonts;
  const lines = wrapRuns(
    [
      { text: northrop.disclaimer.lead, font: boldItalic },
      { text: " ", font: italic },
      { text: northrop.disclaimer.body, font: italic },
    ],
    DISCLAIMER.size,
    CONTENT_W,
  );
  const reserve = (lines.length - 1) * DISCLAIMER.pitch;
  lines.forEach((line, i) => {
    const baseline =
      i === 0
        ? w.baseline(DISCLAIMER.gap, reserve)
        : w.baseline(DISCLAIMER.pitch);
    w.runs(line, LEFT, baseline, DISCLAIMER.size, MUTED);
  });
}

/** What writeMemo leaves for the rest of the export pack to reuse. */
export interface MemoResources {
  fonts: MemoFonts;
  icon: PDFImage;
  /** The memo's pages, in order (at the start of the document). */
  pages: PDFPage[];
}

/** Builds the branded Site Instruction Memo as PDF bytes. */
export async function renderMemoPdf(
  input: MemoPdfInput,
  assets: MemoAssets,
  signature: MemoSignature | null = null,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  await writeMemo(doc, input, assets, signature);
  return doc.save();
}

/** Writes the memo's pages into `doc` (expected to be empty). */
export async function writeMemo(
  doc: PDFDocument,
  input: MemoPdfInput,
  assets: MemoAssets,
  signature: MemoSignature | null = null,
): Promise<MemoResources> {
  doc.registerFontkit(fontkit);

  const fontEntries = await Promise.all(
    (Object.keys(assets.fonts) as FontKey[]).map(
      async (key) =>
        [
          key,
          await doc.embedFont(assets.fonts[key], { subset: true }),
        ] as const,
    ),
  );
  const fonts = Object.fromEntries(fontEntries) as Fonts;
  const [wordmark, icon] = await Promise.all([
    doc.embedPng(assets.wordmarkCream),
    doc.embedPng(assets.icon),
  ]);

  const title = referenceLine(input.reference, input.fields.itemInspected);
  doc.setTitle(title);
  doc.setSubject(northrop.memoTitle);
  doc.setAuthor(input.fields.inspector || northrop.name);
  doc.setCreator("Northrop Hardhat");

  const w = new MemoWriter(doc, fonts, wordmark, icon);
  w.addPage();
  const headerBottom = drawHeader(w, input);
  drawRecipients(
    w,
    input.fields.recipients,
    Math.max(RECIPIENTS.minTop, headerBottom + 40),
  );
  drawDetails(w, input.fields);
  drawBody(w, input, signature ? await doc.embedPng(signature) : null);
  drawDisclaimer(w);
  w.drawFooters();

  return { fonts, icon, pages: w.pages };
}
