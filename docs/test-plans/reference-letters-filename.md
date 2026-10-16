# Manual test plan: project reference letters and the export file name

Device: iPad [model], iPadOS [version]
Build/commit:
Tester / date:

Reply with step numbers and what you saw.

1. **Update.** Open the app, accept the update if offered, and check Settings shows the new commit.
2. **Default.** Open a project's page: under Project details, **Memo reference letters** is empty, and the note says new memos are numbered SIM001, SIM002….
3. **Set letters.** Type **ssi**: it shows SSI001, SSI002…. Leave the page and come back: SSI is kept.
4. **New memo.** Start a new inspection in that project and create its memo: the reference is the job's next number with SSI, e.g. **SSI003** if the job had two memos before.
5. **Existing memos.** A memo made before this update keeps its reference (e.g. SIM-001).
6. **Another project.** A project with no letters set still gives SIM… references.
7. **File name.** Export the PDF pack: the file is named like **SY000001-SSI003-A-Level 3 slab.pdf** (job number, reference, A, item inspected, with spaces). Share it to Files and Mail: the name arrives intact.
