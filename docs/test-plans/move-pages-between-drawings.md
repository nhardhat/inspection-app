# Manual test plan: moving pages between drawings

Device: iPad [model], iPadOS [version]
Build/commit:
Tester / date:

Use an inspection with two drawing sets (a test one is fine). Reply with step numbers and what you saw.

1. **Update.** Open the app, accept the update if offered, and check Settings shows the new commit.
2. **Hint.** Open the drawings, tap the **Page** button: the Pages view says "Hold a page, then drag it to move it, even into another drawing."
3. **Scroll still works.** Swipe up and down through the pages straight away (without holding): it scrolls as before. A quick tap still goes to the page.
4. **Lift.** Hold a page with a pin on it for about half a second: it lifts under your finger and its place fades. (Does a copy/share menu or text selection pop up? It shouldn't.)
5. **Drag into another set.** Drag it over a page of the other drawing: a red bar shows on its left or right, with a label like "Move to S-102 Level 4, after page 7". Let go: "Page moved into …", and the page sits there.
6. **Scroll while dragging.** With a long set, drag a page near the bottom (or top) edge: the list scrolls. Drop it far down.
7. **In the drawings.** Close the Pages view and scroll to the moved page: it shows its own sheet, sharp when zoomed, with its pin, markup and notes box. Letters follow the new order (check the Items panel).
8. **Back home.** Drag it back into its own drawing: it's an ordinary page again.
9. **Within a set.** Drag a page to another place in the same drawing: it moves (the menu's Move page earlier / later still work too).
10. **Reorder drawings.** With a page moved into another set, use **Reorder drawings…**: the moved page goes with the drawing it was moved into.
11. **Export.** Export the PDF pack: the moved page (with pins) comes in its new place, at its own size, from its own sheet.
12. **Delete.** On Pre-inspection, delete the drawing that lent the page: the warning says its page moved into another drawing goes too. Confirm: that page (and its pins) is gone from the other set; the rest are re-lettered.
13. **Backup.** Back up an inspection with a moved page and import it with **Keep both**: the moved page shows correctly in the copy.
