# Manual test plan: storage limits (step 10d)

Device: iPad [model], iPadOS [version]
Build/commit:
Tester / date:

Filling an iPad on purpose isn't practical, so the "full" message is tested automatically (a fake full device); here we check the everyday parts. Reply with step numbers and what you saw.

1. **Update.** Open the app, accept the update if offered, and check Settings shows the new commit.
2. **Dashboard tile.** The Storage tile shows how much is used, of how much, and "Kept by the iPad" (or "May be cleared"). Tell me which one it says, and roughly the two numbers.
3. **Big set.** Add your biggest real drawing set (20-30 MB): it adds without errors, and the Storage tile grows by about its size.
4. **Export.** Export a full pack with that set: note roughly how long it takes and the file size shown.
5. **Back up all.** Settings, Storage and backup, **Back up all**: it finishes and the Share sheet opens; save the files to Files.
