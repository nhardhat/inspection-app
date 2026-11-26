# Manual test plan: memo office

Device: iPad [model], iPadOS [version]; a PC with Chrome or Edge for step 7
Build/commit:
Tester / date:

1. **Update.** Settings, About shows the new commit.
2. **Old memo.** Open an inspection whose memo was made before this update: the preview's red sidebar still shows the Sydney office, and the job details line ends "· Sydney office".
3. **My office.** Settings, My details: **Office** reads Sydney. Pick Newcastle.
4. **New memo.** Start a new inspection, Site memo, Create memo: the preview's sidebar shows Level 1, 215 Pacific Hwy, Charlestown NSW 2290, 02 4943 1777, newcastle@northrop.com.au, then the ABN. The job details line ends "· Newcastle office".
5. **This memo only.** Edit job details, **Office**: pick Melbourne. The preview changes straight away; check the longest address (Suite 3, Level 23, 385 Bourke St) sits inside the red sidebar. The older memo from step 2 still shows Sydney, and Settings still reads Newcastle.
6. **Export.** Export PDF and Preview it: the Melbourne block is on the memo page. Export Word and open it: the same block in the sidebar.
7. **Every office.** For each of Brisbane, Canberra, Coffs Harbour, Parramatta, Sydney and Wollongong, pick it on the memo and check the preview's address against northrop.com.au/location.
8. **Backup.** Back up the inspection, delete it, import the file: the memo still shows Melbourne.
9. Set Settings, Office back to your own office.
