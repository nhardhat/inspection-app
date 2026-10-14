# Manual test plan: background drawing in the drawings screen

Device: iPad [model], iPadOS [version]
Build/commit:
Tester / date:

The drawings screen now draws pages from the PDF on a background thread, as the drawing lab did, so touches shouldn't wait while a page draws. The drawing lab now lives in Settings, Developer. Reply with step numbers and what you saw; for readings, paste the diagnostics panel's **Copy** text (page numbers and paper sizes only).

1. **Update.** Open the app, accept the update if offered, and check Settings shows the new commit.
2. **Where it draws.** Settings, Developer: unlock with the password and turn on **Show diagnostics**. Open the inspection with the B1 set. The panel should say **Drawing on the background**. (If it says "main thread (...)", copy the panel and stop here.)
3. **No freeze while it draws.** On the busy B1 page, pinch to about 2× and let go. During the ~2 s before it turns sharp, scroll or pinch again straight away. Does the page move at once, without the old stall?
4. **Sharp as before.** Let it settle at 2×, then 4×. Do the lines, hatching and text turn crisp, the same as before this update? Is anything missing or different (text, shading, colours)?
5. **Freeze reading.** After step 4, the **Drawing last … longest freeze** line should be well under 100 ms (it was over 1,400 ms). Copy the panel and paste it here.
6. **New pages.** Add a drawing set you haven't opened yet (or one with no saved pages). Scroll through it: pages appear once you stop, and scrolling stays smooth while they draw and save.
7. **Saved images still work.** Close the app fully and reopen the same set. Pages should show at once (diagnostics: "from saved image").
8. **Pinch snapshot.** At a sharp zoom, start a pinch: the page stays put under your fingers with no flash or blank area, then sharpens again after you let go.
9. **Markup unchanged.** Draw a pen line and add a pin on the B1 page while zoomed in: both behave as before, and the markup stays crisp when still.
10. **Errors.** At the end, does the panel still say **Errors none**? If not, copy it here.
