import { writeFileSync, mkdirSync } from "node:fs";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { beforeAll, describe, expect, test } from "vitest";
import fontkit from "@pdf-lib/fontkit";
import { northrop, officeBlock } from "../../../brand/northrop";
import { sampleMemo } from "../sampleMemo";
import {
  renderMemoPdf,
  type MemoAssets,
  type MemoPdfInput,
} from "./renderMemoPdf";
import { loadTestMemoAssets } from "./memoAssets.testutil";

let assets: MemoAssets;

/** Set MEMO_PDF_DIR to keep the rendered PDFs for a visual check. */
function saveForInspection(name: string, bytes: Uint8Array) {
  const dir = process.env.MEMO_PDF_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/${name}`, bytes);
}

beforeAll(async () => {
  assets = await loadTestMemoAssets();
});

/** All text on each page, whitespace collapsed. */
async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const texts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str + (item.hasEOL ? " " : "") : ""))
      .join(" ");
    texts.push(text.replace(/\s+/g, " ").trim());
  }
  return texts;
}

function withConditions(count: number): MemoPdfInput {
  return {
    ...sampleMemo,
    conditions: Array.from(
      { length: count },
      (_, i) =>
        `${i + 1}. Sample condition number ${i + 1} for overflow testing.`,
    ),
  };
}

describe("renderMemoPdf", () => {
  test("renders the sample memo as one A4 page with every field", async () => {
    const bytes = await renderMemoPdf(sampleMemo, assets);
    saveForInspection("sample-memo.pdf", bytes);

    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo(northrop.page.width, 1);
    expect(height).toBeCloseTo(northrop.page.height, 1);
    expect(doc.getTitle()).toBe("SIM-001 – Level 3 slab reinforcement");

    const [text] = await pageTexts(bytes);
    const f = sampleMemo.fields;
    for (const value of [
      f.clientName,
      f.clientCompany,
      f.address1,
      f.address2,
      "1 October 2026",
      f.jobNumber,
      f.jobName,
      "SIM-001 – Level 3 slab reinforcement",
      "SITE INSTRUCTION MEMO",
      "SITE VISIT REQUESTED BY",
      f.inspector,
      f.salutation,
      "Ok to proceed subject to the following:",
      "Yours sincerely,",
      f.signOffTitle,
      ...officeBlock(null),
      "REAL PEOPLE",
      ...f.recipients.map((r) => r.company),
    ]) {
      expect(text).toContain(value);
    }
  });

  test("shows the memo's office in the sidebar, Sydney by default", async () => {
    const [sydney] = await pageTexts(await renderMemoPdf(sampleMemo, assets));
    expect(sydney).toContain("Level 10, 400 George St Sydney NSW 2000");
    for (const office of northrop.offices) {
      const bytes = await renderMemoPdf(
        { ...sampleMemo, officeId: office.id },
        assets,
      );
      saveForInspection(`office-${office.id}.pdf`, bytes);
      const [text] = await pageTexts(bytes);
      expect(text).toContain(officeBlock(office.id).join(" "));
    }
    const [newcastle] = await pageTexts(
      await renderMemoPdf({ ...sampleMemo, officeId: "newcastle" }, assets),
    );
    expect(newcastle).not.toContain("George St");
  });

  test("every office's lines fit inside the red sidebar", async () => {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const font = await doc.embedFont(assets.fonts.regular);
    // Sidebar right edge 169 pt, text from 27.8 pt: keep the same margin
    // on the right as on the left.
    const room = 169 - 2 * 27.8;
    for (const office of northrop.offices)
      for (const line of officeBlock(office.id))
        expect(font.widthOfTextAtSize(line, 6.96), line).toBeLessThan(room);
  });

  test("includes the disclaimer word for word", async () => {
    const [text] = await pageTexts(await renderMemoPdf(sampleMemo, assets));
    expect(text).toContain(
      `${northrop.disclaimer.lead} ${northrop.disclaimer.body}`,
    );
  });

  test("embeds Figtree and no standard fonts", async () => {
    const doc = await PDFDocument.load(await renderMemoPdf(sampleMemo, assets));
    const fonts = doc
      .getPage(0)
      .node.Resources()!
      .lookup(PDFName.of("Font"), PDFDict);
    const names = fonts
      .values()
      .map((ref) =>
        String(doc.context.lookup(ref, PDFDict).get(PDFName.of("BaseFont"))),
      );
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(name).toMatch(/Figtree/);
  });

  test("shows 'Ok to proceed.' with no list when there are no conditions", async () => {
    const [text] = await pageTexts(
      await renderMemoPdf(withConditions(0), assets),
    );
    expect(text).toContain("Ok to proceed.");
    expect(text).not.toContain("subject to the following");
  });

  test("flows a long condition list onto a second page with page numbers", async () => {
    const bytes = await renderMemoPdf(withConditions(30), assets);
    saveForInspection("overflow-memo.pdf", bytes);
    const texts = await pageTexts(bytes);

    expect(texts.length).toBe(2);
    expect(texts[1]).toContain("30. Sample condition number 30");
    expect(texts[1]).toContain(northrop.disclaimer.lead);
    expect(texts[1]).not.toContain("SITE INSTRUCTION MEMO");
    expect(texts[1]).toMatch(/REAL IMPACT 2$/);
  });

  test("lists ten recipients, flowing on when the page fills", async () => {
    const input: MemoPdfInput = {
      ...sampleMemo,
      fields: {
        ...sampleMemo.fields,
        recipients: Array.from({ length: 10 }, (_, i) => ({
          company: `Recipient Company ${i + 1}`,
          attn: `Person ${i + 1}`,
          to: i === 0,
          copy: i > 0,
        })),
      },
    };
    const bytes = await renderMemoPdf(input, assets);
    saveForInspection("ten-recipients-memo.pdf", bytes);
    const text = (await pageTexts(bytes)).join(" ");
    for (let i = 1; i <= 10; i++)
      expect(text).toContain(`Recipient Company ${i}`);
    expect(text).toContain(northrop.disclaimer.lead);
  });

  test("replaces characters the font cannot draw instead of failing", async () => {
    const input = {
      ...sampleMemo,
      fields: { ...sampleMemo.fields, salutation: "Dear Alex 👷," },
    };
    const [text] = await pageTexts(await renderMemoPdf(input, assets));
    expect(text).toContain("Dear Alex ?,");
  });
  test("prints a signature between the sign-off and the name", async () => {
    // Any PNG will do: the footer icon stands in for a signature.
    const signed = await renderMemoPdf(sampleMemo, assets, assets.icon);
    const unsigned = await renderMemoPdf(sampleMemo, assets);
    saveForInspection("signed-memo.pdf", signed);

    const images = async (bytes: Uint8Array) => {
      const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
      const ops = await (await doc.getPage(1)).getOperatorList();
      return ops.fnArray.filter((fn) => fn === pdfjs.OPS.paintImageXObject)
        .length;
    };
    expect(await images(signed)).toBe((await images(unsigned)) + 1);

    // The name moves down to make room for the 40 pt signature.
    const nameY = async (bytes: Uint8Array) => {
      const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
      const content = await (await doc.getPage(1)).getTextContent();
      // The last match: the inspector row shows the same name.
      const item = content.items.findLast(
        (it) => "str" in it && it.str === sampleMemo.fields.signOffName,
      );
      return item && "transform" in item ? (item.transform[5] as number) : NaN;
    };
    const drop = (await nameY(unsigned)) - (await nameY(signed));
    expect(drop).toBeGreaterThan(25);
    expect(drop).toBeLessThan(35);
  });
});
