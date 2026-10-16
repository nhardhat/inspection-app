# CLAUDE.md

Read `SPEC.md` first. It is the source of truth for scope, data model, and build order. If a request conflicts with the spec, say so and ask before changing direction.

## Project

Offline-capable PWA, iPad first, for a structural engineer's site inspections: mark up drawing PDFs with lettered pins, attach photos, generate an editable Site Instruction Memo, export one PDF pack. Calculators and a standard details library come later (not in slice 1) as **separate areas of the app**, never part of the memo or inspection data.

## Stack

TypeScript, React, Vite, vite-plugin-pwa, pdfjs-dist (render), pdf-lib (export), Dexie (IndexedDB), Vitest, Playwright.

## Commands

Node 24, npm.
- `npm run dev` start dev server (http://localhost:5173/inspection-app/)
- `npm run build` production build (typecheck + Vite build into `dist/`)
- `npm run preview` serve the production build (service worker active)
- `npm test` unit tests (Vitest)
- `npm run test:e2e` Playwright (iPad viewport, against the production build)
- `npm run lint` and `npm run typecheck`
- `npm run format` / `npm run format:check` Prettier

Run typecheck, lint and tests before saying a task is done.

## Working rules

- Work in thin vertical slices. Finish one workflow end to end before starting the next.
- For anything non-trivial, propose a short plan and wait for approval before editing many files.
- Keep commits small and focused. Commit before starting a risky change.
- One concern per PR/commit. Do not refactor unrelated code.
- Prefer boring, widely understood libraries. Someone else will inherit this.
- Ask when a requirement is ambiguous instead of guessing, especially for report wording and engineering content.

## Architecture rules

- **Offline first.** Nothing may require a network at runtime. No CDN assets, no remote fonts, no analytics. Everything needed is bundled or precached.
- **All user data lives in IndexedDB via Dexie.** Never rely on in-memory-only state for anything the user created. No localStorage for records (small UI prefs only).
- **Pin positions are normalised page coordinates (0..1)**, never screen pixels.
- **Letters are per kind, per inspection**: instructions A, B ... Z, AA ... and observations A, B ... separately, each in document order: drawing order, then page, then the order on that page (placement order unless reordered in the Items tab) (engineer decision, 2026-10-02), so an instruction A and an observation A can both exist; always say which ("Instruction A"). Adding, deleting or switching the kind of an item, or deleting a drawing, re-letters so there are no gaps (memos are checked before sending).
- **PDF export is built with pdf-lib**, not browser print. The memo layout must match the brand tokens in `SPEC.md`.
- **Inspection file** (zip with `schemaVersion`) must round-trip losslessly. Add a test for export then import.
- Keep `/src/engineering` free of UI and framework imports so calculators stay pure and testable.
- Calculators are a separate app area (`src/features/calculators`). They must not import from, write to, or be referenced by the inspection, memo or export code, and calculation records are never included in the inspection file or PDF pack.

## iPad Safari constraints (test on a real device)

- Use Pointer Events; distinguish `pointerType` pen/touch/mouse for pan vs draw.
- Avoid features unsupported in iOS Safari PWAs. Check support before relying on a web API.
- Large PDFs: render only visible pages at device-appropriate resolution, release canvases when off screen.
- Compress photos on import (about 1600 px long edge, JPEG ~0.8). Respect EXIF orientation.
- Request persistent storage; surface storage usage; always offer Back up now.

## Engineering content (calculators, later slices)

- Never invent formulas, clause numbers or coefficients. Every calculation cites the AS 3600 clause it implements in a code comment.
- Every calculator needs unit tests against worked hand-calc examples supplied by the engineer.
- Show inputs, assumptions, units and results clearly. Display a notice that results must be verified by the engineer.
- If unsure about a clause, stop and ask. Do not approximate.

## Memo content

- The disclaimer and office block are fixed template text. Do not reword them.
- Branding is hard-coded to Northrop for the POC but must live in one module (`src/brand/northrop.ts`), not scattered through layout code.
- Items are either `instruction` or `observation`. Only instructions appear in the memo, in the "Ok to proceed subject to the following:" list. Observations never appear in the memo; they go in a draggable text box burned into the marked-up drawing page (see SPEC section 5).
- Exported drawing pages keep their native page size.
- Memo references are the project's letters (default SIM) + three digits, e.g. `SIM001`, per job number (see SPEC section 7a). No re-inspection or open/closed item status in the POC.
- Prefilled messages live in the Snippet table and are user-editable. Do not hard-code them into components.
- Brand tokens: red `#DA1A32`, cream `#FFF2DF`, maroon `#580B07`, grey `#3B3B3B`, font Figtree, A4.

## Data and security

- No real client data, drawings or secrets in prompts, test fixtures, or the repo. Use synthetic fixtures.
- Check company policy before using real project material with any AI tool.

## Definition of done

Works offline on an iPad viewport, typecheck/lint/tests pass, the relevant section of `SPEC.md` is updated if behaviour changed, and a short note describes what to test manually on the iPad.
