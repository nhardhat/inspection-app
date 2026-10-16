import starterSnippets from "../../content/snippets.json";
import { confirmationParts } from "./memoTemplate";
import type { MemoPdfInput } from "./pdf/renderMemoPdf";

const itemInspected = "Level 3 slab reinforcement";

const worksGenerallyInAccordance =
  starterSnippets.find((s) => s.id === "body-works-generally-in-accordance")
    ?.text ?? "";

/** Synthetic memo for the PDF renderer tests. No real client, job or person. */
export const sampleMemo: MemoPdfInput = {
  reference: "SIM-001",
  fields: {
    clientName: "Alex Example",
    clientCompany: "Example Builders Pty Ltd",
    address1: "1 Sample Street",
    address2: "Exampleville NSW 2000",
    date: "2026-10-01",
    jobNumber: "SY000001",
    jobName: "Example Apartments",
    recipients: [
      {
        company: "Example Builders Pty Ltd",
        attn: "Alex Example",
        to: true,
        copy: false,
      },
      {
        company: "Example Certifiers",
        attn: "Sam Sample",
        to: false,
        copy: true,
      },
      {
        company: "Example Architects",
        attn: "Jordan Demo",
        to: false,
        copy: true,
      },
    ],
    siteVisitRequestedBy: "Alex Example, Example Builders Pty Ltd",
    reasonForVisit: itemInspected,
    inspector: "Test Engineer",
    sentVia: "Email",
    salutation: "Dear Alex,",
    itemInspected,
    signOffName: "Test Engineer",
    signOffTitle: "Structural Engineer",
  },
  bodyParagraphs: [
    confirmationParts(itemInspected),
    worksGenerallyInAccordance,
  ],
  conditions: [
    "A. Sample instruction text for item A.",
    "B. Sample instruction text for item B, long enough to wrap onto a second line so the hanging indent can be checked.",
    "C. Sample instruction text for item C.",
    "Confirm completion of items via photos prior to proceeding.",
  ],
};
