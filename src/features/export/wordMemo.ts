/**
 * The memo as a Word document (engineer, 2026-10-20;
 * feedback round 1, item 6): the Northrop sample memo's layout, filled in
 * as the PDF memo is (buildMemoPdfInput), with real, editable text. As in
 * the sample, the red sidebar is a picture behind the page, with the title
 * and office block as text over it; the footer has the roundel, strapline
 * and page number. Figtree is embedded so it looks right on any computer.
 * The drawings and photos stay in the PDF pack (engineer, 2026-10-23:
 * the PDF is the main export). Made with `docx` (bundled, loaded
 * only when exporting); measurements follow the PDF memo's.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  FrameAnchorType,
  Footer,
  Header,
  HorizontalPositionRelativeFrom,
  ImageRun,
  LevelFormat,
  LineRuleType,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TabStopType,
  TextRun,
  TextWrappingType,
  VerticalAlign,
  VerticalPositionRelativeFrom,
  WidthType,
  type IParagraphOptions,
  type ParagraphChild,
} from "docx";
import { northrop } from "../../brand/northrop";
import { buildMemoPdfInput } from "../memo/buildMemo";
import { memoFilename } from "../memo/memoFilename";
import {
  DETAIL_LABELS,
  RECIPIENT_HEADINGS,
  SIGN_OFF,
  conditionsLeadIn,
  formatMemoDate,
  referenceLine,
  type TextPart,
} from "../memo/memoTemplate";
import type { MemoAssets } from "../memo/pdf/renderMemoPdf";
import type { PackData } from "./packContents";

/** Twentieths of a point (Word's unit for spacing and sizes). */
const tw = (pt: number) => Math.round(pt * 20);
/** Pixels at 96 dpi (docx's unit for pictures). */
const px = (pt: number) => Math.round((pt * 96) / 72);
/** English Metric Units (docx's unit for picture positions). */
const emu = (pt: number) => Math.round(pt * 12700);
/** Half-points (Word's font size unit). */
const hp = (pt: number) => Math.round(pt * 2);

const hex = (c: string) => c.slice(1).toUpperCase();
const GREY = hex(northrop.colours.grey);
const CREAM = hex(northrop.colours.cream);
const MAROON = hex(northrop.colours.maroon);
const RULE = hex(northrop.colours.rule);
const MUTED = hex(northrop.colours.muted);
const FONT = northrop.font.family;
const SEMIBOLD = `${FONT} SemiBold`;

/* The PDF memo's page (points from the top left). */
const PAGE = { width: 595.28, height: 841.89 };
const LEFT = 184.3;
const TABLE_RIGHT = 546;
const SIDEBAR = { top: 27.6, width: 169, height: 786.2 - 27.6 };
const TITLE = { x: 26.6, top: 187, width: 140 };
const OFFICE = { x: 27.8, top: 676, width: 140 };
/** Footer: the roundel's bottom 25.6 pt up, as in the PDF memo (engineer, 2026-10-23: it sat too low). */
const MARGIN = { top: 42.5, right: 72, bottom: 72, header: 25.5, footer: 25.6 };

/** The sidebar pictures (4 px per point), made from the brand's red. */
export interface WordAssets {
  memo: MemoAssets;
  sidebarFirst: Uint8Array;
  sidebar: Uint8Array;
}

const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const rule = { style: BorderStyle.SINGLE, size: 6, color: RULE };
const noBorders = { top: none, bottom: none, left: none, right: none };

function text(
  value: string,
  options: {
    size?: number;
    bold?: boolean;
    italics?: boolean;
    color?: string;
    font?: string;
  } = {},
) {
  return new TextRun({
    text: value,
    size: hp(options.size ?? 9),
    bold: options.bold,
    italics: options.italics,
    color: options.color ?? GREY,
    font: options.font ?? FONT,
  });
}

function para(
  children: ParagraphChild[],
  options: Omit<IParagraphOptions, "children"> = {},
) {
  return new Paragraph({
    spacing: { after: tw(4), line: tw(12.95), lineRule: LineRuleType.EXACT },
    ...options,
    children,
  });
}

/** A paragraph holding a picture: its line grows to fit it. */
function picture(children: ParagraphChild[]) {
  return new Paragraph({
    spacing: { after: tw(2), line: 240, lineRule: LineRuleType.AUTO },
    children,
  });
}

/** The sidebar behind the page, with (on the first page) its text. */
function sidebarHeader(picture: Uint8Array, first: boolean) {
  const image = new ImageRun({
    type: "png",
    data: picture,
    transformation: { width: px(SIDEBAR.width), height: px(SIDEBAR.height) },
    floating: {
      horizontalPosition: {
        relative: HorizontalPositionRelativeFrom.PAGE,
        offset: 0,
      },
      verticalPosition: {
        relative: VerticalPositionRelativeFrom.PAGE,
        offset: emu(SIDEBAR.top),
      },
      behindDocument: true,
      wrap: { type: TextWrappingType.NONE },
    },
  });
  const frame = (x: number, top: number, width: number, height: number) => ({
    type: "absolute" as const,
    position: { x: tw(x), y: tw(top) },
    width: tw(width),
    height: tw(height),
    anchor: {
      horizontal: FrameAnchorType.PAGE,
      vertical: FrameAnchorType.PAGE,
    },
  });
  const children: Paragraph[] = [new Paragraph({ children: [image] })];
  if (first) {
    children.push(
      new Paragraph({
        frame: frame(TITLE.x, TITLE.top, TITLE.width, 14),
        children: [
          text(northrop.memoTitle, { size: 9, bold: true, color: CREAM }),
        ],
      }),
    );
    children.push(
      ...northrop.officeBlock.map(
        (line, i) =>
          new Paragraph({
            frame: frame(OFFICE.x, OFFICE.top + i * 10.1, OFFICE.width, 10.1),
            children: [text(line, { size: 6.96, color: CREAM })],
          }),
      ),
    );
  }
  return new Header({ children });
}

/** The roundel, the strapline and the page number. */
function memoFooter(icon: Uint8Array) {
  const outdent = tw(LEFT - 28.35);
  const strapline = northrop.strapline.join(" · ");
  return new Footer({
    children: [
      new Paragraph({
        indent: { left: -outdent },
        tabStops: [
          {
            type: TabStopType.RIGHT,
            position: tw(560.5 - LEFT) + outdent,
          },
        ],
        children: [
          new ImageRun({
            type: "png",
            data: icon,
            transformation: { width: px(11.25), height: px(11.25) },
          }),
          text(`   ${strapline}`, { size: 5.04 }),
          new TextRun({
            children: ["\t", PageNumber.CURRENT],
            size: hp(6),
            color: GREY,
            font: FONT,
          }),
        ],
      }),
    ],
  });
}

function cell(
  children: Paragraph[],
  width: number,
  options: { fill?: string; borders?: object } = {},
) {
  return new TableCell({
    width: { size: tw(width), type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    margins: { left: tw(5.5), right: tw(5.5), top: tw(3), bottom: tw(3) },
    borders: (options.borders ?? noBorders) as never,
    shading: options.fill
      ? { type: ShadingType.CLEAR, color: "auto", fill: options.fill }
      : undefined,
    children,
  });
}

/** Client and address on the left; date, job and reference on the right. */
function headerBlock(input: ReturnType<typeof buildMemoPdfInput>) {
  const f = input.fields;
  const left = [
    para([text(f.clientName, { size: 8 })]),
    para([text(f.clientCompany, { size: 9 })]),
    para([text(f.address1, { size: 8 })]),
    para([text(f.address2, { size: 8 })]),
  ];
  const right = [
    para([text(formatMemoDate(f.date), { size: 8 })]),
    para([text("")]),
    para([text(f.jobNumber)]),
    para([text(f.jobName, { font: SEMIBOLD })]),
    para([
      text(referenceLine(input.reference, f.itemInspected), { font: SEMIBOLD }),
    ]),
  ];
  return new Table({
    width: { size: tw(TABLE_RIGHT - LEFT), type: WidthType.DXA },
    columnWidths: [tw(184.4), tw(TABLE_RIGHT - LEFT - 184.4)],
    borders: { ...noBorders, insideHorizontal: none, insideVertical: none },
    rows: [
      new TableRow({
        children: [cell(left, 184.4), cell(right, TABLE_RIGHT - LEFT - 184.4)],
      }),
    ],
  });
}

function recipientsTable(input: ReturnType<typeof buildMemoPdfInput>) {
  const widths = [35, 37.3, 133.9, 155.5];
  const borders = { top: none, left: none, right: none, bottom: rule };
  const inner = { ...borders, right: rule };
  const head = [
    RECIPIENT_HEADINGS.to,
    RECIPIENT_HEADINGS.copy,
    RECIPIENT_HEADINGS.company,
    RECIPIENT_HEADINGS.attn,
  ];
  const box = (on: boolean) => (on ? "☒" : "☐");
  return new Table({
    width: { size: tw(TABLE_RIGHT - LEFT), type: WidthType.DXA },
    columnWidths: widths.map(tw),
    rows: [
      new TableRow({
        tableHeader: true,
        children: head.map((h, i) =>
          cell([para([text(h, { size: 11 })])], widths[i], {
            fill: CREAM,
            borders: noBorders,
          }),
        ),
      }),
      ...input.fields.recipients.map(
        (r) =>
          new TableRow({
            children: [
              cell(
                [para([text(box(r.to))], { alignment: AlignmentType.CENTER })],
                widths[0],
                { borders: inner },
              ),
              cell(
                [
                  para([text(box(r.copy))], {
                    alignment: AlignmentType.CENTER,
                  }),
                ],
                widths[1],
                { borders: inner },
              ),
              cell([para([text(r.company)])], widths[2], { borders: inner }),
              cell([para([text(r.attn)])], widths[3], { borders }),
            ],
          }),
      ),
    ],
  });
}

function detailsTable(input: ReturnType<typeof buildMemoPdfInput>) {
  const f = input.fields;
  const label = 255.8 - LEFT;
  const rows: [string, string][] = [
    [DETAIL_LABELS.siteVisitRequestedBy, f.siteVisitRequestedBy],
    [DETAIL_LABELS.reasonForVisit, f.reasonForVisit],
    [DETAIL_LABELS.inspector, f.inspector],
    [DETAIL_LABELS.sentVia, f.sentVia],
  ];
  const borders = { top: rule, bottom: rule, left: none, right: none };
  return new Table({
    width: { size: tw(TABLE_RIGHT - LEFT), type: WidthType.DXA },
    columnWidths: [tw(label), tw(TABLE_RIGHT - LEFT - label)],
    rows: rows.map(
      ([name, value]) =>
        new TableRow({
          children: [
            cell(
              [
                para([
                  text(name, { size: 6.96, font: SEMIBOLD, color: MAROON }),
                ]),
              ],
              label,
              { fill: CREAM, borders: { ...borders, right: rule } },
            ),
            cell([para([text(value)])], TABLE_RIGHT - LEFT - label, {
              borders,
            }),
          ],
        }),
    ),
  });
}

/** A body paragraph: plain text, or parts with italics. */
function bodyParagraph(value: string | TextPart[]) {
  const parts = typeof value === "string" ? [{ text: value }] : value;
  return para(
    parts.map((p) => text(p.text, { italics: p.italic })),
    {
      spacing: { after: tw(4) },
    },
  );
}

/** Builds the memo as .docx bytes. */
export async function buildWordMemo(
  data: PackData,
  assets: WordAssets,
): Promise<Uint8Array> {
  const { inspection, memo } = data;
  const input = buildMemoPdfInput(
    memo,
    inspection,
    data.items,
    data.conditionSnippets,
    data.photoLine,
    data.referLine,
  );
  const fonts = assets.memo.fonts;

  const body: (Paragraph | Table)[] = [
    headerBlock(input),
    para([text("")], { spacing: { after: tw(24) } }),
    recipientsTable(input),
    para([text("")], { spacing: { after: tw(10) } }),
    detailsTable(input),
    para([text("")], { spacing: { after: tw(10) } }),
    bodyParagraph(input.fields.salutation),
    ...input.bodyParagraphs.map(bodyParagraph),
    bodyParagraph(conditionsLeadIn(input.conditions.length, input.photoLine)),
    ...input.conditions.map((c) =>
      para([text(c)], { numbering: { reference: "conditions", level: 0 } }),
    ),
    para([text(SIGN_OFF)], { spacing: { before: tw(20), after: tw(8) } }),
  ];
  if (memo.includeSignature && data.signature)
    body.push(
      picture([
        new ImageRun({
          type: "png",
          data: data.signature,
          transformation: { width: px(120), height: px(40) },
        }),
      ]),
    );
  else body.push(para([text("")], { spacing: { after: tw(20) } }));
  body.push(
    para([text(input.fields.signOffName, { bold: true })]),
    para([text(input.fields.signOffTitle)]),
    para(
      [
        text(northrop.disclaimer.lead, {
          size: 6.96,
          bold: true,
          italics: true,
          color: MUTED,
        }),
        text(` ${northrop.disclaimer.body}`, {
          size: 6.96,
          italics: true,
          color: MUTED,
        }),
      ],
      { spacing: { before: tw(24), line: tw(10.1) } },
    ),
  );

  const doc = new Document({
    creator: northrop.name,
    title: referenceLine(memo.reference, inspection.itemInspected),
    fonts: [
      {
        name: FONT,
        data: fonts.regular as never,
        bold: fonts.bold as never,
        italic: fonts.italic as never,
        boldItalic: fonts.boldItalic as never,
      },
      { name: SEMIBOLD, data: fonts.semiBold as never },
    ],
    styles: {
      default: {
        document: { run: { font: FONT, size: hp(9), color: GREY } },
      },
    },
    numbering: {
      config: [
        {
          reference: "conditions",
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "•",
              alignment: AlignmentType.LEFT,
              style: {
                run: { font: FONT, size: hp(9), color: GREY },
                paragraph: {
                  indent: {
                    left: tw(220.4 - LEFT),
                    hanging: tw(220.4 - 204.7),
                  },
                },
              },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          titlePage: true,
          page: {
            size: { width: tw(PAGE.width), height: tw(PAGE.height) },
            margin: {
              top: tw(MARGIN.top),
              right: tw(MARGIN.right),
              bottom: tw(MARGIN.bottom),
              left: tw(LEFT),
              header: tw(MARGIN.header),
              footer: tw(MARGIN.footer),
            },
          },
        },
        headers: {
          first: sidebarHeader(assets.sidebarFirst, true),
          default: sidebarHeader(assets.sidebar, false),
        },
        footers: {
          first: memoFooter(assets.memo.icon),
          default: memoFooter(assets.memo.icon),
        },
        children: body,
      },
    ],
  });
  return new Uint8Array(await (await Packer.toBlob(doc)).arrayBuffer());
}

/** "SY000001-SIM001-A-Level 3 slab.docx". */
export function wordFilename(data: PackData): string {
  return memoFilename(
    data.inspection.jobNumber,
    data.memo.reference,
    data.inspection.itemInspected,
  ).replace(/\.pdf$/, ".docx");
}
