/**
 * What's new, by milestone (engineer, 2026-10-07: milestones only), newest
 * first. Shown in Settings, About. Add an entry when the version goes up.
 */
export const CHANGELOG: { version: string; date: string; items: string[] }[] = [
  {
    version: "0.3.0",
    date: "20 October 2026",
    items: [
      "Busy drawings draw in the background: no more freezes while a sheet sharpens, and the areas round the view are drawn ahead so nearby scrolling is sharp",
      "Crisp zoom on busy sheets and markup",
      "Move pages between drawings: hold a page in the Pages view and drag it anywhere",
      "PDF preview zooms up to 10×, sharp at any zoom, around your fingers",
      "Memo: instructions needing photos are marked *, explained in the line above the list",
      "Memo: Refer to drawings, one line instead of a long list of instructions",
      "Memo: the item inspected in italics",
      "Drag to reorder memo recipients and a project's contacts",
      "Each project can set its memo reference letters (SIM001, SSI001); the PDF is named like SY000001-SIM001-A-Level 3 slab.pdf",
      "A plain message when the iPad runs out of space, and a Dashboard warning when it's nearly full",
      "Diagnostics and the drawing lab moved to Settings, Developer (password)",
      "Checked to work end to end with no connection: drawings, memo, export, backup and import",
    ],
  },
  {
    version: "0.2.0",
    date: "7 October 2026",
    items: [
      "Pencil markup: pen, highlighter (fluoro colours), line, arrow, rectangle, ellipse and revision cloud, in colour slots and three weights",
      "Draw and hold: a held stroke becomes a straight line, or a clean circle, rectangle, triangle or polygon you can resize before lifting",
      "Text callouts with dog-leg arrows, placed and moved like pins; pin arrows are dog legs too",
      "Select: tap or loop round marks to move, resize, rotate (one shape or a group), recolour, change weight, duplicate, delete or edit callouts",
      "General notes: observations with no pin, listed in every page's notes box",
      "Eraser, and undo with a two-finger double-tap",
      "Markup in the PDF pack and in inspection files",
      "Photo confirmation shown against each instruction in the memo",
      "New name and icon: Northrop Hardhat",
      "The Dashboard opens any step of the last inspection",
      "A user guide and a features and limitations document, here in About, opening in the app with a Back button",
      "Hold and drag: the arrowhead stays on the spot pressed and the pin or text box follows your finger",
      "Project badges show one letter; Settings warns not to remove the app from the home screen",
      "Diagnostics panel for the drawings (Settings, Drawing), to measure performance on the iPad",
      "Smoother scrolling through busy drawings: each page is saved as an image the first time it's drawn, so it appears at once after that",
    ],
  },
  {
    version: "0.1.0",
    date: "5 October 2026",
    items: [
      "Projects and inspections, with a Dashboard and an Inspections list",
      "Drawings as one continuous document, with a Pages view to duplicate, hide and reorder pages",
      "Lettered instruction and observation pins, with arrows, copy pins and a notes box on each page",
      "Photos from the camera or library, with captions and saving to the iPad",
      "The Site Instruction Memo, with prefilled messages, recipients, signature and a live preview",
      "The PDF pack: memo, marked-up drawings and photo appendix",
      "Inspection files for backup and moving between devices; works offline",
    ],
  },
];
