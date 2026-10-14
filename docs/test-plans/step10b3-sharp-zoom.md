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
9. **Crisp drawing (13 Oct).** Zoom into a busy spot on the B1 sheet and hold still until the pieces finish: the hatching and linework are as crisp as in the exported PDF (no A/B/C switch any more).
10. **Crisp markup.** On a page with pen lines, highlighter, a shape, a text callout and a pin with its notes box, zoom in and hold still: within about a second all of them look as crisp as the drawing. Highlighter isn't any darker than before.
11. **Touching.** Press on the page (or start drawing): the markup goes back to its softer look while you touch, then crisp again just after you let go. Drag the notes box and a callout, tap a pin, draw a line, use the eraser: everything works as before.
12. **Typing.** Tap a callout twice to edit it while zoomed in: it stays usable while you type; crisp again after you finish.
13. **Export unchanged.** Export the PDF pack: markup is in the same places as on screen.

After the 14 Oct clean-up (one sharp drawing per view)

14. **Navigate and wait.** Zoom into a new spot on the B1 sheet and hold still: about half a second later it starts sharpening, and it's crisp within a few seconds (about 1.5–4 s on that sheet, not 13+). Copy a reading once crisp: one Sharp line with a time, no "pieces".
15. **Responsiveness.** Straight after navigating, try to pan or zoom again: say whether you still have to wait 2–3 s (a freeze can still happen if you move during the drawing; the "longest freeze" line says how long).
16. **Nothing missing.** Scroll through the set at fit width: pages appear from their saved images as before; a page never seen before may show blank white until you stop, then draws.

