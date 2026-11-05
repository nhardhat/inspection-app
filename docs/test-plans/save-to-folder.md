# Manual test plan: save to folder on the PC

Device: Windows PC, Chrome or Edge [version]; iPad [model] for step 6
Build/commit:
Tester / date:

Use an inspection with a memo. Reply with step numbers and what you saw.

1. **Update.** Open the app on the PC and check Settings shows the new commit.
2. **PDF.** Site memo, Export card: **Export PDF**, then **Save to folder…**. The Windows Save As box opens with the file name filled in. Pick a job folder and save: "Saved … .pdf" shows under the buttons, and the file opens from that folder.
3. **Same folder next time.** **Export Word**, then **Save to folder…**: the box opens in the folder from step 2. Save it.
4. **Register.** **Export defect register**, then **Save to folder…**: saves the .xlsx the same way.
5. **Cancel.** Open the box again and press Cancel: nothing happens and no error shows.
6. **iPad unchanged.** On the iPad, the Export card has no Save to folder button; Share works as before.

Backups:

7. **One inspection.** Pre-inspection, Backup card: **Back up now**, then **Save to folder…**. Save it in a backups folder: "Saved … .inspection" shows and the status changes to "Backed up".
8. **Own folder.** Export a PDF and **Save to folder…**: the box opens in the job folder from step 2, not the backups folder.
9. **Back up all.** Settings, Storage and backup: **Back up all**, then **Save to folder…**. Pick the backups folder (Chrome asks once to let the site edit files there: allow). "Saved N files to …" shows, one .inspection file per inspection is in the folder, and it says every inspection is backed up.
10. **Import one back.** On the Inspections page, import one of those files: it asks before replacing the inspection, as before.
11. **iPad unchanged.** On the iPad the Backup card and Back up all have no Save to folder button.
