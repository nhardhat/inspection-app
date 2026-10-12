# Manual test plan: step 10b part 3, sharp images when zoomed (and B sizes)

Device: iPad [model], iPadOS [version]
Build/commit:
Tester / date:

Reply with the step number and what you saw (no need to edit this file). Use the slow B1 set, with **Show diagnostics** on; for readings tap **Copy** and paste the text.

1. **B1 label.** The panel names the sheet "B1 (1000 × 707 mm)" (and so does the PDF viewer for B1 pages).
2. **Zoom in, wait.** Zoom to about 1.2× and hold still. Within a few seconds the lines go crisp and stay crisp. Copy a reading once crisp: the Sharp lines say "(as wanted)" with a time, not "drawing".
3. **Small moves.** Pan or scroll a little (less than half a screen) and stop: the lines stay crisp straight away (nothing redrawn; Copy and paste: the Sharp times are unchanged).
4. **Zoom in, out, then scroll.** The sequence that was slow: zoom in, zoom out, then scroll several pages. Say how smooth it feels; Copy straight after (the Scroll line).
5. **Big moves.** Scroll a long way at 1.2× and stop: the new spot goes crisp within a few seconds (the soft base image shows meanwhile).
6. **Pieces (after the 12 Oct update).** Zoom into the busy B1 sheet and hold still: after about half a second it sharpens in squares from the middle out, and the finished page looks as crisp as before. Copy a reading: the Sharp line ends "N of N pieces", and a "Drawing last … longest freeze …" line shows the longest the screen froze.
7. **Move mid-way.** Zoom in, and as soon as the squares start appearing, zoom out and scroll: no long freeze (Copy straight after; the Scroll line's worst frame should be well under a second).
8. **Still blurry?** If anywhere the lines stay blurry while the panel says "Sharp … (as wanted)" with a time (finished), Copy that reading and say so: that points to the display problem the A/B/C comparison is for.
9. **Display A, B, C (12 Oct).** Zoom into a spot that looks blurry on the B1 sheet and wait until the panel's Sharp line says "N of N pieces". Then tap **A**, **B** and **C** in the panel's Display row, looking closely at the same lines each time. Which is crisp: A, B, C, or none? Copy a reading with the crisp one selected (the first line says which display).
