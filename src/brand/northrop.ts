/**
 * Northrop brand values for the POC (SPEC 4a). All brand values live here so
 * a later swap only touches this module. Layout code (memo PDF, app CSS)
 * reads from here and never embeds brand values itself.
 *
 * Fixed text is copied verbatim from docs/reference/Northrop_sample_report.docx.
 * Do not reword it.
 */

export const northrop = {
  name: "Northrop",
  colours: {
    red: "#DA1A32",
    cream: "#FFF2DF",
    maroon: "#580B07",
    grey: "#3B3B3B",
    /** Table rules in the memo. */
    rule: "#B0B0B0",
    /** Disclaimer text in the memo. */
    muted: "#898989",
  },
  font: {
    family: "Figtree",
  },
  /**
   * Drawing markup (pins and the notes box burned into drawing pages).
   * Instruction pins use colours.red; observation pins and the notes box use
   * markup.blue, except the box's header line, which is markup.header. The
   * notes box is set in Arial capitals; exported PDFs use
   * Helvetica, Arial's metric twin, which every PDF viewer has built in.
   */
  markup: {
    blue: "#0165FC",
    header: "#000000",
    notesFont: "Arial",
    notesPdfFont: "Helvetica",
  },
  /** A4 portrait in PDF points. */
  page: {
    width: 595.28,
    height: 841.89,
  },
  memoTitle: "SITE INSTRUCTION MEMO",
  officeBlock: [
    "Level 10, 400 George St",
    "Sydney NSW 2000",
    "02 9241 4188",
    "sydney@northrop.com.au",
    "ABN 81 094 433 100",
  ],
  /** First sentence is bold in the memo; the rest follows in italic. */
  disclaimer: {
    lead: "Site safety remains the responsibility of the builder.",
    body: "Any inspection carried out by Northrop Consulting Engineers Pty Ltd does not relieve the Contractor of their responsibility to construct the structure in accordance with the drawings and specifications. Statements set out here do not relieve the Contractor of his obligations to obtain approvals from authorities having jurisdiction over the works. This does not constitute authorisation for a contract variation unless stated in the instruction. No claim will be accepted unless approval of variation is obtained before any work proceeds.",
  },
  strapline: ["REAL PEOPLE", "REAL PARTNERSHIPS", "REAL IMPACT"],
  /**
   * Sketch pages (engineer, 2026-10-20): the title strip of Northrop's A4
   * calc pad (BB-002 Bluebeam drawing templates), rebuilt, without PARTNERS.
   */
  sketchLabels: {
    project: "PROJECTS:",
    jobNumber: "JOB NO:",
    sketchNumber: "SKETCH NO:",
    revision: "REV NO:",
    designed: "DESIGNED:",
    scale: "SCALE :",
    date: "DATE :",
  },
  /**
   * Asset URLs, bundled by Vite and precached for offline use. Vite only
   * rewrites `new URL("literal", import.meta.url)`, so keep the paths literal.
   */
  assets: {
    /** Cream wordmark for the red sidebar (sample image1.png). */
    wordmarkCream: new URL(
      "./assets/northrop-wordmark-cream.png",
      import.meta.url,
    ).href,
    /** Red wordmark for the app's top bar. */
    wordmarkRed: new URL("./assets/northrop-wordmark-red.png", import.meta.url)
      .href,
    /**
     * The memo's red sidebar as pictures for the Word memo (behind the
     * page, as in the sample; 4 px per point): with the wordmark on the
     * first page, plain after.
     */
    sidebarFirst: new URL("./assets/memo-sidebar-first.png", import.meta.url)
      .href,
    sidebar: new URL("./assets/memo-sidebar.png", import.meta.url).href,
    /** Maroon wordmark for the sketch pad (the Northrop calc pad's). */
    wordmarkMaroon: new URL(
      "./assets/northrop-wordmark-maroon.png",
      import.meta.url,
    ).href,
    /** Red "N" roundel for the footer (sample image3.png). */
    icon: new URL("./assets/northrop-icon.png", import.meta.url).href,
    /** Static Figtree TTFs for PDF embedding (SIL OFL, see assets/fonts/OFL.txt). */
    fonts: {
      regular: new URL("./assets/fonts/Figtree-Regular.ttf", import.meta.url)
        .href,
      italic: new URL("./assets/fonts/Figtree-Italic.ttf", import.meta.url)
        .href,
      semiBold: new URL("./assets/fonts/Figtree-SemiBold.ttf", import.meta.url)
        .href,
      bold: new URL("./assets/fonts/Figtree-Bold.ttf", import.meta.url).href,
      boldItalic: new URL(
        "./assets/fonts/Figtree-BoldItalic.ttf",
        import.meta.url,
      ).href,
    },
  },
} as const;
