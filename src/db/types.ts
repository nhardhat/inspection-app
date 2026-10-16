/**
 * Record types stored in IndexedDB (SPEC section 8). Ids are UUID strings.
 * File bytes (PDFs, photos) live in the `blobs` table and are referenced by id.
 */

export interface Client {
  name: string;
  company: string;
  address1: string;
  address2: string;
}

/** A job's saved details, shared by all its inspections (SPEC section 8). */
export interface Project {
  id: string;
  jobNumber: string;
  jobName: string;
  client: Client;
  /** Memo recipients used before, offered when adding recipients. */
  contacts: Contact[];
  createdAt: number;
  updatedAt: number;
}

export interface Contact {
  id: string;
  company: string;
  attn: string;
}

export interface Inspection {
  id: string;
  /** Its project; null until it's put in one ("Needs a project"). */
  projectId: string | null;
  /** e.g. "Level 3 slab reinforcement". Prefills the memo and heads the observations box. */
  itemInspected: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  inspector: string;
  /** Workflow status. Values are settled in build step 4 (inspection CRUD). */
  status: string;
  /** General photos: not tied to a pin; the appendix's General group. */
  photoIds: string[];
  /**
   * Job details an inspection had before projects existed, kept when it had
   * no job number (so it wasn't put in a project) to start one from.
   */
  unsorted?: { jobName: string; client: Client };
  createdAt: number;
  updatedAt: number;
  /** When it was last saved to an inspection file (Back up now); edits after it need a new backup. */
  backedUpAt?: number;
}

/** An inspection with its project's job details, as screens and the memo read them. */
export type JobInspection = Inspection &
  Pick<Project, "jobNumber" | "jobName" | "client">;

/** One page of a drawing as it appears in the document (SPEC section 5). */
export interface DrawingPage {
  /** 1-based page of the PDF it shows (a duplicate repeats its original's). */
  source: number;
  /** Left out of the document, its numbering and the PDF pack; restorable. */
  hidden?: boolean;
}

export interface Drawing {
  id: string;
  inspectionId: string;
  name: string;
  pdfBlobId: string;
  /** Pages in the PDF file. */
  pageCount: number;
  /**
   * The drawing's pages in document order: the PDF's pages to start with,
   * then duplicated (a copy right after its original) or hidden in the
   * Pages view. Items and notes boxes refer to a page by its 1-based
   * position here, hidden pages included, so hiding never moves them.
   */
  pages: DrawingPage[];
  /** PDF size in bytes (kept here so listing drawings never loads the file). */
  fileSize: number;
  /**
   * Each page's [width, height] in points, so the whole inspection document
   * can be laid out without loading every PDF. Filled on upload, or the first
   * time the document is opened for drawings added before this existed.
   */
  pageSizes?: [number, number][];
  /** Drawings appear in the document in the order they were added. */
  createdAt: number;
}

export type ItemKind = "instruction" | "observation";

export interface Item {
  id: string;
  inspectionId: string;
  /**
   * A, B ... Z, AA ... per kind across the inspection, in pin creation
   * order with no gaps (instruction A and observation A can both exist).
   */
  letter: string;
  kind: ItemKind;
  drawingId: string;
  /** 1-based position in the drawing's pages (Drawing.pages). */
  page: number;
  /** Normalised page coordinates (0..1), never screen pixels. */
  x: number;
  y: number;
  text: string;
  /** Only meaningful for instructions. */
  requiresPhotoConfirmation: boolean;
  photoIds: string[];
  createdAt: number;
  /**
   * Order among the items on its page: placement order unless the engineer
   * reorders them. Letters follow drawing, page, then sequence.
   */
  sequence: number;
  /** Arrows from the pin to the spots it refers to, on the same page. */
  arrows: ItemArrow[];
  /**
   * More spots the same item is pinned at (Copy pin): same letter, text and
   * photos. The original position above decides the letter; copies never
   * re-letter anything. Each copy has its own arrows.
   */
  copies?: PinCopy[];
  /**
   * A general note (engineer, 2026-10-07): an observation with no pin,
   * listed in every page's notes box before the pinned ones and lettered
   * first. Its drawingId is "" and page, x and y are 0.
   */
  general?: boolean;
}

/** Another spot an item is pinned at (any drawing and page). */
export interface PinCopy {
  id: string;
  drawingId: string;
  /** 1-based position in that drawing's pages. */
  page: number;
  x: number;
  y: number;
  arrows: ItemArrow[];
}

/** An arrow's tip, in normalised coordinates (0..1) of the item's page. */
export interface ItemArrow {
  id: string;
  x: number;
  y: number;
}

export interface Photo {
  id: string;
  /** The working copy: JPEG, about 1600 px on the long edge (SPEC section 6). */
  blobId: string;
  /**
   * The camera's full-size original, kept so it can be saved to the iPad
   * at native resolution. Library picks have none (they are already in
   * Photos); "Free up space" removes it once saved.
   */
  originalBlobId?: string;
  /** Bytes of the kept original (shown as storage used, without loading it). */
  originalSize?: number;
  source: "camera" | "library";
  caption?: string;
  takenAt: number;
  /** Size of the working copy in pixels. */
  width: number;
  height: number;
  /** When it was last saved to the iPad (Share sheet), if ever. */
  savedAt?: number;
}

/** The stored files behind a photo (working copy, and original if kept). */
export function photoBlobIds(photo: Photo): string[] {
  return photo.originalBlobId
    ? [photo.blobId, photo.originalBlobId]
    : [photo.blobId];
}

/**
 * File bytes. Stored as an ArrayBuffer, not a Blob: Blob storage in
 * IndexedDB is not supported by every WebKit build, ArrayBuffers are.
 */
export interface StoredBlob {
  id: string;
  data: ArrayBuffer;
  /** MIME type, e.g. "application/pdf". */
  type: string;
  size: number;
}

/**
 * A drawing page's base image, saved losslessly (PNG) the first time it is
 * drawn so it shows at once next time (step 10b; SPEC section 12). Exactly
 * the image the viewer would draw; never in inspection files (remade after
 * an import) and tidied away when its drawing is deleted.
 */
export interface PageImage {
  /** `${drawingId}:${source}:${width}x${height}` */
  id: string;
  drawingId: string;
  /** The PDF page it shows (1-based). */
  source: number;
  width: number;
  height: number;
  /** PNG bytes. */
  data: ArrayBuffer;
  size: number;
  createdAt: number;
}

export type SentVia = "Aconex" | "Email";

export interface Recipient {
  company: string;
  attn: string;
  to: boolean;
  copy: boolean;
}

/** Per-job memo fields (SPEC section 4). Wired up in build step 7. */
export interface MemoFields {
  clientName: string;
  clientCompany: string;
  address1: string;
  address2: string;
  date: string;
  jobNumber: string;
  jobName: string;
  recipients: Recipient[];
  siteVisitRequestedBy: string;
  reasonForVisit: string;
  inspector: string;
  sentVia: SentVia;
  salutation: string;
  itemInspected: string;
  signOffName: string;
  signOffTitle: string;
}

/**
 * A Site Instruction Memo (SPEC section 4), one per inspection. Job details
 * (client, address, date, job number and name, item inspected, inspector)
 * are not copied here: the memo shows the inspection's, so they never
 * disagree. Instruction lines come from the items; only rewordings are kept.
 */
export interface Memo {
  id: string;
  inspectionId: string;
  templateId: string;
  /** SIM-NNN, per job number (SPEC 7a). Editable. */
  reference: string;
  recipients: Recipient[];
  /** Null: the default (client name, client company). */
  siteVisitRequestedBy: string | null;
  /** Null: the inspection's item inspected. */
  reasonForVisit: string | null;
  sentVia: SentVia;
  /** Null: "Dear {first name}," from the first To recipient. */
  salutation: string | null;
  /** Body paragraph 2: the prefilled message it started from, and its text. */
  bodySnippetId: string | null;
  bodyText: string;
  /**
   * Standard conditions (condition snippets) ticked or unticked by the
   * engineer. A snippet not listed uses its default.
   */
  conditionChoices: Record<string, boolean>;
  /** Instruction lines reworded for this memo, by item id (without letter). */
  itemOverrides: Record<string, string>;
  /**
   * One line pointing to the drawings instead of the A, B, C… list (the
   * referDrawings message), for memos with many pins. Missing: off.
   */
  referToDrawings?: boolean;
  signOffName: string;
  signOffTitle: string;
  /** The memo's own copy of the signature (PNG in blobs), if it has one. */
  signatureBlobId: string | null;
  /** Print the signature between "Yours sincerely," and the name. */
  includeSignature: boolean;
  /** When the PDF pack was last exported (build step 8). */
  exportedAt?: number;
  /**
   * Each item's kind and letter at that export ("instruction:A" by item
   * id), to warn when letters change before the memo is sent.
   */
  exportedLetters?: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

export interface MemoCounter {
  jobNumber: string;
  lastSeq: number;
}

export interface MemoTemplate {
  id: string;
  name: string;
  branding: {
    colours: Record<string, string>;
    logoBlobId?: string;
    fonts: string[];
  };
  fixedText: {
    disclaimer: string;
    officeBlock: string;
  };
}

export interface ObservationBox {
  id: string;
  drawingId: string;
  /** 1-based position in the drawing's pages (Drawing.pages). */
  page: number;
  /** Normalised top-left (0..1). */
  x: number;
  y: number;
}

/** Shapes (slice 2b), each drawn by a drag from corner to corner. */
export const SHAPES = ["line", "arrow", "rect", "ellipse", "cloud"] as const;
export type MarkupShape = (typeof SHAPES)[number];

/**
 * Shapes made by drawing and holding (SPEC 5a, 2026-10-07): a polygon
 * through its corners, or a tilted ellipse (centre, then its axes' ends).
 */
export type HeldShape = "polygon" | "oval";

/** What a mark is: a pen or highlighter stroke, a shape or a text callout (SPEC 5a). */
export type MarkKind = "pen" | "highlighter" | MarkupShape | HeldShape | "text";

/** Toolbar tools with their own colour slot and weight (text: its size). */
export type MarkupTool = "pen" | "highlighter" | "shapes" | "text";

/** One mark drawn on a drawing page (SPEC section 5a). */
export interface Markup {
  id: string;
  inspectionId: string;
  drawingId: string;
  /** 1-based position in the drawing's pages (Drawing.pages). */
  page: number;
  tool: MarkKind;
  /**
   * Normalised points (0..1 of the page), flat: x0, y0, x1, y1... A shape
   * has two: where its drag started and ended.
   */
  points: number[];
  /** "#rrggbb". */
  colour: string;
  /** Line width as a fraction of the sheet's short side. */
  weight: number;
  /**
   * Closed shapes (rectangle, ellipse, cloud) are filled lightly in their
   * colour; false once the eraser took the fill off.
   */
  fill?: boolean;
  /**
   * Rectangles, ellipses and clouds turned about their centre (radians,
   * clockwise on the page); their points stay the level box (SPEC 5a,
   * 2026-10-07). Other marks rotate by moving their points.
   */
  rotation?: number;
  /**
   * A shape made by holding the highlighter: drawn like a highlight
   * (see-through, multiplied in the PDF), never filled.
   */
  highlight?: boolean;
  /**
   * Text callouts: what it says (capitals). Their points are the box's
   * x, y, width and height, then the leader's tip if it has one; weight is
   * the text size.
   */
  text?: string;
  /**
   * Text callouts: the box's width was set by hand (resized), so its text
   * wraps to it; otherwise the box grows with the text.
   */
  fixedWidth?: boolean;
  createdAt: number;
}

/**
 * "photoNote": the memo line explaining the * on instructions needing
 * photo confirmation, joined to the conditions lead-in.
 */
/** "referDrawings": the line replacing the instructions (Refer to drawings). */
export type SnippetKind =
  "body" | "condition" | "heading" | "photoNote" | "referDrawings";

export interface Snippet {
  id: string;
  kind: SnippetKind;
  label: string;
  text: string;
}

export const SETTINGS_ID = "app";

/** Single settings record, id `SETTINGS_ID`. */
export interface Settings {
  id: typeof SETTINGS_ID;
  inspectorName: string;
  inspectorTitle: string;
  defaultSentVia: SentVia;
  /** Set once the starter snippets have been seeded; they are never re-seeded. */
  snippetsSeeded: boolean;
  /** My signature (PNG in blobs), copied into each new memo. */
  signatureBlobId?: string | null;
  /** Result of the first-run navigator.storage.persist() request. */
  persistRequested?: { granted: boolean; at: number };
}
