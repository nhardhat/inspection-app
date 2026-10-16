# Manual test plan: photo *, reordering contacts, Refer to drawings

Device: iPad [model], iPadOS [version]
Build/commit:
Tester / date:

Reply with step numbers and what you saw.

**Photo confirmation as \***

1. **Update.** Open the app, accept the update if offered, and check Settings shows the new commit.
2. **Settings.** Settings, Prefilled messages: **Photo confirmation line** reads "Items marked \* to be closed out with photos". (If you'd changed the old note, your text is kept: change it to suit.)
3. **Memo.** In an inspection with two instructions, turn on **Photo confirmation required** for one. Site memo: that instruction shows **\* photo confirmation** by its letter, and the line above the conditions reads "Ok to proceed subject to the following. Items marked \* to be closed out with photos:". The preview shows the same, with "A. … \*" in the list. The other instruction has no \*.
4. **Notes box.** On the drawing, the notes box shows that instruction with \* at the end. Export the PDF pack: the drawing page shows the same.
5. **No photos.** Turn photo confirmation off on both: the \* goes, and the lead-in is back to "Ok to proceed subject to the following:".

**Reordering contacts**

6. **Recipients.** In the memo, with two or more recipients, drag a row's **≡** up or down: the order changes, and the preview follows.
7. **Project contacts.** Open the project's page: drag a contact's **≡** to a new place. Leave and come back: the order stayed. In a new memo, **Add from contacts** lists them in that order.

**Refer to drawings**

8. **Switch.** In the memo, turn on **Refer to drawings** (above the instructions). The instruction list is replaced by "Complete the instructions marked on the attached drawings (items A–B)." Ticked standard conditions still show, and the lead-in still explains the \*, in the preview too.
9. **Off again.** Turn it off: the instructions come back, with any rewording you'd made.
10. **Settings.** Settings, Prefilled messages, **Refer to drawings**: change the wording, keeping [letters]. The memo follows.
11. **Export.** With it on, export the PDF pack: the memo has the one line; the drawing pages still list every instruction in their notes boxes.
