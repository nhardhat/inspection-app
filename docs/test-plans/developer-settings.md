# Manual test plan: Settings, Developer (password)

Device: iPad [model], iPadOS [version]
Build/commit:
Tester / date:

Reply with step numbers and what you saw.

1. **Locked.** Settings: **Developer** is last in the section list. Tap it: the card shows a Password box and Unlock, and no diagnostics switch or lab link. Settings, Drawing now has only Pencil prediction.
2. **Wrong password.** Type something wrong and tap Unlock: "Wrong password." and it stays locked.
3. **Right password.** Type the password (capitals or not) and tap Unlock (or Return): **Show diagnostics** and **Drawing lab** appear, with a **Lock** button.
4. **Diagnostics.** Turn on Show diagnostics and open a drawing: the panel shows as before.
5. **Lab.** Back in Settings, Developer, open **Drawing lab**: pick the B1 busy page at 2×, then tap **Draw on main thread** and **Draw in background**. Both lines appear, and the background one has a short freeze. Copy the results here.
6. **Lock.** Tap Lock: the card goes back to the Password box.
7. **Closing the app locks it.** Unlock, then swipe the app away and reopen it: Developer is locked again. (The diagnostics panel stays on if you left it on; it's switched off in Developer.)
