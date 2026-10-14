# Handover prompt (paste into a new chat)

You're picking up an in-progress build. Read CLAUDE.md, then SPEC.md (source of truth), then docs/decisions/log.md before doing anything.

PROJECT
- **Northrop Hardhat** ("Hardhat" under the home-screen icon): an offline-first iPad PWA for a structural engineer's site inspections at Northrop. Repo: C:\Users\dsamson\Desktop\CODING\inspection-app, remote https://github.com/nhardhat/inspection-app (public). Every push to main runs CI (typecheck, lint, format, unit, e2e, build) and deploys to GitHub Pages at **https://nhardhat.github.io/inspection-app/**.
- The GitHub account was renamed jabbaby → nhardhat on 2026-10-08 (the old jabbaby.github.io address is dead). iPad data belongs to the address it was installed from: the engineer moves by Back up all in the old app, then Import in the new one, before removing the old app. If the repo is ever made private, Pages switches off and has to be re-enabled (Settings, Pages, source GitHub Actions).
- Stack: React 19 + TypeScript + Vite, vite-plugin-pwa, Dexie (IndexedDB, **schema v13**: v13 added `pageImages`), pdfjs-dist 6.3 (viewer, thumbnails, memo preview, Dashboard thumbnail, in-app PDF viewer, the background drawing worker), pdf-lib (memo PDF, export, manual PDFs), lucide-react, Vitest, Playwright (iPad Pro 11 viewport; WebKit, plus Chromium for @offline tests).
- Version 0.2.0 (package.json; bumped per milestone, entry in src/content/changelog.ts). The app shows "Version 0.2.0 (<commit>)" on the Dashboard, in Settings and About.
- Local git identity is set (noreply 310427615+jabbaby@users.noreply.github.com; still valid after the rename). End commit messages with: Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Dev server configs in .claude/launch.json ("dev", port 5173; "preview", port 4174).

WORKING AGREEMENTS (important)
- Auto-push to main is allowed, but only after the full gate passes locally: typecheck, lint, format:check, unit tests, and e2e against a FRESH build. Then poll CI and confirm the deploy (the live bundle contains the commit). Never push with failing or skipped checks; a flaky e2e test means rerun the full suite until it's clean. If I say "don't push yet", keep changes local.
- For anything non-trivial: short plan first, wait for approval. For UI work, show a mockup first. Ask before guessing tool behaviour, report wording or engineering content. I often answer by number, sometimes tersely: if an answer is ambiguous, confirm rather than guess.
- Show me screenshots with SendUserFile (images you only Read aren't visible to me).
- Small focused commits, each one buildable.
- When behaviour changes: update SPEC.md and docs/decisions/log.md, and write or extend a manual iPad test plan in docs/test-plans/ as a NUMBERED LIST. I reply with step numbers.
- When features or limitations change, update the documents (see DOCUMENTS) and rebuild them.
- Repo, test fixtures and chats stay synthetic. Real drawings are allowed in the app only. Don't ask me for screenshots of real drawings: ask for the diagnostics panel's **Copy** text instead (it holds page numbers and paper sizes only).
- I'm right-handed: viewer controls on the right edge; panels open on the left. Markup tools are a GoodNotes-style toolbar across the top.
- No Mac: no Safari Web Inspector. Don't guess at iPad-only rendering or performance problems: measure with the diagnostics panel (or the drawing lab) and ask me for a reading. Both are in Settings, Developer, behind a password I know (never write it in the repo; e2e unlocks with the helper unlockDeveloperTools, a session flag).
- I asked (2026-10-14) whether we were congesting the code. Keep it lean: remove experiments that don't pay off, and say so.

STATUS (2026-10-14)
- Steps 1 to 9 DONE and iPad-verified. Slice 2 markup DONE and iPad-verified (2026-10-07), including Select, rotation, general notes, documents, About.
- Fixes after slice 2 (iPad-confirmed "all good" 2026-10-08): one-letter project badges; Settings warning not to remove the app from the Home Screen; hold-and-drag places the arrowhead first then drags the pin or callout out.
- **Step 10 hardening, in progress (step 10b: drawing speed and sharpness, mostly on a busy B1 sheet with hatching):**
  - 10a diagnostics panel (Settings, Developer, Show diagnostics; password): per page on screen, base and sharp render detail vs wanted, times, canvases, marks, scroll fps and worst frame (with what was busy), longest freeze while drawing, PDF open time, errors; Copy as text.
  - 10b (live): saved page images (lossless PNG per page and size, Dexie `pageImages`, shown at once in any session, saved ahead in the background while still, tidied when a drawing goes); PDF drawing only while the document is still, one at a time, on-screen pages first (a queue with pausing); one sharp drawing of the view and a margin, 0.6 s after settling, kept while it covers the view; the sharp image and a display-only crisp copy of the markup laid out at TRUE SCREEN SIZE (Safari blurs anything inside the magnified page; confirmed by a live A/B/C comparison on the iPad); B0–B4 paper labels. Removed after readings showed no benefit: drawing in pieces, a low-detail preview while scrolling, a recent-pages memory cache.
  - Engineer feedback after the clean-up: "much better" sharpness; remaining problem is lag: pdf.js draws on the main thread and the B1 sheet takes ~1.5–3 s per drawing, freezing touches.
  - **Drawing lab result (2026-10-14, iPad):** background drawing WORKS in iPad Safari. B1 busy page: main thread 2× ~2950 ms with a 1.43 s freeze; background 2× ~1980 ms with a 17–21 ms longest freeze (one frame); 1× and 4× similar; the engineer: the two pictures look the same.
  - **Background drawing built in (2026-10-14, live 1be5876):** pageDrawer.ts + drawingWorker.ts. Then (engineer) Settings, Developer, password-locked until the app closes: Show diagnostics and the drawing lab (src/features/lab, route #/lab/drawing, redirects to Settings while locked; its background half uses pageDrawer). iPad plans docs/test-plans/step10b4-background-drawing.md (1–10) and docs/test-plans/developer-settings.md waiting.
- iPad test plans waiting: docs/test-plans/step10b4-background-drawing.md, docs/test-plans/step10b3-sharp-zoom.md (steps 9–16), docs/test-plans/step10b2-saved-pages.md (housekeeping steps 9–11).

NEXT (agreed; plan first, the engineer approves)
1. DONE (2026-10-14): background drawing in the drawings screen. Next is the engineer's reading from step10b4-background-drawing.md.
2. PDF preview fix (asked by the engineer, plan agreed in principle, waiting on: OK + maximum zoom; currently 6×, suggested 8–10×). src/app/PdfViewer.tsx draws each page once as a JPEG ≤2400 px and CSS-scales it (blurry when zoomed; zoom grows from the top-left and re-lays out every move). Plan: keep the PDF open, redraw the visible part from the vectors at full screen size when zooming stops (reuse the worker from 1), PNG not JPEG, pinch as one transform around the fingers then one layout on lift, −/+ around the screen centre. The exported PDF itself is vector and fine.
3. Rest of step 10: 10c large drawings (adding a big PDF: the whole file is read into memory and copied once for pdf.js; export time and pack size; backup files); 10d storage limits (clear message on quota errors when adding drawings or photos or importing; Dashboard warning when nearly full or not persisted); 10e offline tests (export, import, backup offline; airplane-mode iPad plan).
4. Possible later: a true-screen-size viewer (markup drawn into a screen-sized canvas instead of the crisp-copy trick) as a LAB PAGE reading existing data read-only, never as a forked deploy (same site = shared data). The engineer pasted a generic "matrix viewport" blueprint; assessed: we already do its core (world coords, inverse transform, snapshot pinch), its JS panning and CSS-scaled PDF canvas would regress (lost momentum, blur), and it doesn't address pdf.js main-thread drawing.
5. Later list (not scheduled): free-form revision clouds; sort order for prefilled messages; "Take another" photo button; undo for pin moves, notes box moves and page operations; slice 3 calculators (AS 3600, separate area, never in the memo; never invent clauses: ask); slice 4 standard details library.

HOW THE DRAWINGS SCREEN DRAWS (step 10b)
- src/features/drawings/document/DocPage.tsx: per page, base image = saved PNG (savedPages.loadSavedPage, decoded with createImageBitmap) else drawn via the queue when still (then savePageSoon); sharp image = one pdf.js drawing of sharpTarget(view + margin within SHARP_BUDGET 12 MP), SHARP_DELAY_MS 600, placed at true screen size by placeSharpImage (canvas.dataset x/y/w/h in page units, CSS size = px/DPR, scaled back, will-change); crisp markup copy: overlay wrapped in .page-overlay, cloned into .crisp-overlay (counter-scaled) when zoomed and still; original opacity 0 but touchable; touching (onPointerDownCapture), moving or a textarea shows the original; MutationObserver rebuilds the copy.
- pageImages.ts: queuePageDrawing (priority 0 on screen, 1 near, 2 background; a more urgent job pauses a running one; per-run token), baseTarget (MAX_BASE_PIXELS 4 MP), sharpTarget, covers, placeSharpImage.
- savedPages.ts: loadSavedPage, savePageSoon, useSavePagesAhead (background drawing + saving, nearest first, after 1.5 s still); db/pageImages.ts (save/load/ids/prune; pruned at start-up and viewer open).
- DocumentViewer: `moving` state (set in readScroll, cleared in settle) passed to pages; noteScroll for diagnostics; pinchSnapshot draws base + sharp canvases from their dataset positions.
- diagnostics.ts (store, activities, scroll and freeze watchers), diagnosticsReport.ts (lines, unit tested), DiagnosticsPanel.tsx.
- Background drawing: pageDrawer.ts drawPage(doc, drawingId, {source, scale, width, height, offsetX/Y, show, png}) → {promise: {canvas, png}, cancel}; DocPage (base with png, sharp) and useSavePagesAhead (show: false, png) use it inside the queue. drawingWorker.ts: pdf.js in a worker (OffscreenCanvas canvas factory, no-op filter factory, disableFontFace, useWorkerFetch: true, parser worker started by hand with new PDFWorker({ port: new Worker(pdfWorkerUrl, { type: "module" }) })), each drawing's PDF sent once via doc.getData(), closed with usePdfDocuments (closeDrawing), RenderTask.onContinue = setTimeout so a cancel is heard between steps; bitmaps copied into ordinary 2D canvases. Fallback to main-thread drawing when the worker says it can't (no OffscreenCanvas) or a drawing fails there (that drawing stays on the main thread); diagnostics.drawingThread shows which. e2e: Playwright WebKit takes the fallback; the @chromium test (ipad-chromium project) covers the worker.

DOCUMENTS
- docs/manual/features-and-limitations.md (digital innovation team) and docs/manual/user-guide.md (engineers), built to Northrop A4 PDFs in public/docs/ by scripts/build-manual.ts (`npm run docs:build`); screenshots from e2e/manual-shots.spec.ts (`npm run docs:shots`). A blank line now ends a bullet (paragraph after a list is its own paragraph). After rebuilding, render pages with pypdfium2 (pip install into the scratchpad, PYTHONPATH) and check for near-empty pages (one long bullet can push a section onto a new page: shorten it).

HOW THE REST OF THE UI IS BUILT
- One stylesheet: src/app/styles.css (tokens at the top, dark set under prefers-color-scheme). Brand values only from src/brand/northrop.ts. Drawing pages, notes box, memo preview, signature pad stay white in both modes.
- Buttons: :where(button) base rules; colour-only transitions; variants .primary, .emphasis, .quiet, .danger-outline, .danger, .toggle-on, .icon-button.
- Screens: Shell.tsx (rail: Dashboard, Inspections, Settings), Dashboard, Inspections list, Pre-inspection (InspectionHome.tsx), Inspection (DocumentScreen.tsx + DocumentViewer), Site memo (MemoScreen.tsx, ExportCard.tsx), Project page, Settings (SettingsPage.tsx, DrawingSettings.tsx, AboutCard.tsx). src/app/PdfViewer.tsx is the full-screen in-app PDF viewer.
- Markup: src/features/markup (toolbar, prefs, geometry, shape recognition, callouts, select). Items/letters/general notes/copies as in SPEC 5.
- e2e relies on accessible names and data-testids. Helpers: e2e/drawings.spec.ts setupInspection, uploadDrawings, typicalPdf, openDrawing (Pin on unless false), addPinAt, drawLine, sheet; e2e/helpers.ts openTab, openInspectionsList, pinch, pinToolOn, touchTap, stageBox, scrollDocument, startInspection.

KEY DECISIONS (details in SPEC and the log)
- Projects hold job details; letters per kind in document order; notes box per pinned page (every page with general notes); undo/redo session-only (not pin moves, box moves, typing, page operations); memo SIM-NNN per job; export pack = memo + pages with pins or markup (native sizes, vector) + photo appendix; no sync; per-inspection backup files (schemaVersion 2). Saved page images are a cache, never in inspection files.

GOTCHAS LEARNED
- File bytes are stored as ArrayBuffer in the blobs table, not Blob.
- Playwright reuses a server on port 4173: a leftover `vite preview` serves an OLD build. Rebuild before e2e.
- Run the full e2e suite in the FOREGROUND (Bash, 600000 ms timeout).
- Known flaky e2e under load: "photo viewer: a quick flick changes photo", sometimes "create a memo…", "deletes an inspection only after confirming", and a toBeFocused check. Rerun the full suite for a clean run before pushing.
- Marks render in random id order: find marks by data-tool, never nth(). Wait for a new mark to save before tapping it.
- Throwaway specs e2e/zz-*.spec.ts DO run in the full suite: delete them. Screenshot folders (zz-shots): if the shell's cwd is inside one, `rm -rf` fails and a `&&` chain stops silently; cd out first and check the later commands ran.
- Python edit scripts: write them to the scratchpad with Write (newline="" to keep line endings; assert each match). Prettier may reflow a file between edits: re-read before matching.
- iOS Safari: async scrolling; zooms into inputs under 16 px; Share sheet only from a tap; home-screen icons cached until re-added; removing a home-screen app deletes its data.
- **Safari shows content inside a CSS-magnified element from a lower-resolution copy** (blurry when zoomed). Fix: lay the content out at true screen size (CSS px = device px / DPR) and scale it back into place, on its own layer. This was the cause of the "unexplained" blur in October.
- **pdf.js draws on the main thread** and processes the whole page per drawing whatever the area (≈1.5 s on the B1): never draw it in pieces; never draw while moving.
- **pdf.js in a worker:** pass CanvasFactory (OffscreenCanvas), FilterFactory (no-op), disableFontFace: true, useWorkerFetch: true (the default reads document.baseURI), and worker: new PDFWorker({ port }) (otherwise it reads window.location, falls back to a fake worker whose parser takes over self.onmessage). Playwright's desktop WebKit has no OffscreenCanvas in workers: test the worker path in Chromium (the @offline project's grep) and confirm on the iPad.
- React Compiler lint: no setState directly in effect bodies (defer with a microtask or do it in a callback), no performance.now() in render; react-refresh: component files export only components (helpers in their own .ts).
- erasableSyntaxOnly: no TS constructor parameter properties.
- CSS grids sized by content overflow: minmax(0, 1fr). Small buttons need min-width/min-height 0. No display: grid on <details> in Safari.
- Vite only bundles new URL("literal", import.meta.url) (also for workers).
- CI runs in Playwright's Docker image (v1.63.0-noble), 20-minute timeout; runs can wait several minutes in GitHub's queue.
- Poll the Actions API at https://api.github.com/repos/nhardhat/inspection-app/actions/runs?head_sha=<sha> (unauthenticated: 60 requests an hour, poll every 90 s) and confirm the live bundle contains the commit. A 404 on the repo or site means it's private or renamed. gh isn't installed.

OPEN ITEMS
- Remaining drawing lag on busy sheets (NEXT 1). Pencil feel isn't native-level.
- Android/Windows tablets untested. Marketing to be consulted before wider use of the hard-hat icon.
- Limitations (docs/manual/features-and-limitations.md): no sync; data in one browser on one device (backups); one device at a time; SIM references can clash across devices; Android/Windows untested; Share needs a tap after preparing; large real drawings only partly tested; busy sets look soft while flicking the first time through; Pencil not native-level; no re-inspections or item status; undo partial; callout text stays level; no accounts; calculators and details library not built; public hosting.

First, confirm you've read the files and summarise where things stand in a few lines. Then ask me whether the drawing lab's two pictures matched (step 5) before building background drawing in.
