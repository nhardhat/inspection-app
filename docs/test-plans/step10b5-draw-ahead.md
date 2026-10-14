# Manual test plan: drawing ahead when zoomed in

Device: iPad [model], iPadOS [version]
Build/commit:
Tester / date:

Once the view is sharp, the iPad now keeps drawing the areas round it (about a screen each way) at the same zoom, so scrolling nearby should be sharp at once. Reply with step numbers and what you saw; for readings, paste the diagnostics panel's **Copy** text or the lab's **Copy results**.

1. **Update.** Open the app, accept the update if offered, and check Settings shows the new commit. Settings, Developer: unlock and turn on **Show diagnostics**.
2. **Settle, then wait.** Open the B1 set on the busy page and pinch to about 2.5×. Keep still for about 20 seconds. The panel's page section should show **Sharp kept N images** with N going up to about 6–9 (and "· N drawing" while it works).
3. **Scroll nearby.** Now scroll about half a screen, then a full screen, left, right, up and down. Is it sharp straight away (or within a moment)?
4. **Scroll further.** Scroll two or three screens away. It takes the usual couple of seconds there, then fills in round the new spot.
5. **Zoom change.** Pinch to about 4× and keep still: it sharpens, then draws ahead again at the new zoom.
6. **Reading.** After step 5, copy the panel and paste it here. The **Drawing last** line now also says how long the main thread was held up; both numbers should be small (under about 100 ms).
7. **Memory.** Scroll round a few spots at different zooms for a minute. Any blank or black areas, a page that goes blurry and stays blurry, or the app reloading by itself? (The panel's **Canvases** line shows the total; copy it if anything looks wrong.)
8. **Two drawers (lab).** Settings, Developer, **Drawing lab**: pick the B1 busy page at 2×, tap **Two areas: one drawer, then two** and wait for both lines. Copy the results here. If two drawers is clearly faster, the app can use two.
9. **Markup and pins.** While zoomed in and still, add a pin and draw a pen line: both behave as before.
