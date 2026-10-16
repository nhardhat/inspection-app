# Starter snippets (from the sample memo)

These seed the Snippet table. The engineer can edit them in the app. Add new ones here and tell Claude Code to import them.

## Body messages (paragraph 2)
- Works generally in accordance: "At the time of the inspection the works were generally in accordance with the structural design except for the items noted in the attachment."
- Works in accordance: "At the time of the inspection the works were generally in accordance with the structural design."
- Not in accordance – re-inspection: "At the time of the inspection the works were not in accordance with the structural design. The hold point is not released. Rectify the items noted in the attachment and arrange a re-inspection prior to proceeding."
- Not in accordance – photo confirmation: "At the time of the inspection the works were not in accordance with the structural design. The hold point is not released. Rectify the items noted in the attachment and provide photos confirming completion prior to proceeding."

## Standard conditions
- Complete listed items: "Complete items [letters] listed below."
- Photo confirmation: "Confirm completion of items via photos prior to proceeding."

## Observations box heading (kind: heading, shown on the marked-up drawing, not the memo)
- Noted for information: "Noted for information:"
- Noted for information (long): "The following items are noted for information only and do not form conditions of this instruction:"

## Photo confirmation line (kind: photoNote, one only; instructions needing photo confirmation are marked * in the memo and the notes box, and when any is the memo's lead-in reads "Ok to proceed subject to the following. [this line]:")
- Photo confirmation line: "Items marked * to be closed out with photos"

## Refer to drawings (kind: referDrawings, one only; with the memo's Refer to drawings switch on, this line replaces the A, B, C… instructions; [letters] becomes the instruction letters, e.g. A–M)
- Refer to drawings: "Complete the instructions marked on the attached drawings (items [letters])."

## Rules (template logic, not snippets)
- Conditions lead-in: with one or more instruction items, one line "Ok to proceed subject to the following:" then the list, whichever body message is chosen. With no instruction items, "Ok to proceed." and no list.
- Observations never appear in the memo. They go in a draggable text box on each drawing page that has them, and the box is hidden on pages with none.
