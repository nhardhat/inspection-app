# Manual test plan: local sign-in

Devices: iPad [model], iPadOS [version]; a phone and a PC for step 8
Build/commit:
Tester / date:

Use the username and password you were given (they aren't written here).

1. **Update.** Accept the update and reopen the app: it shows the sign-in screen (Hardhat icon, Northrop Hardhat, Username, Password, Sign in) instead of the Dashboard. Sign in is greyed out until both are filled in.
2. **Wrong password.** Type the username and a wrong password, Sign in: "That username or password isn't right. Try again in 1 s." The password box empties.
3. **Waits grow.** Get it wrong twice more: the wait is 2 s, then 4 s; Sign in stays greyed out until it ends.
4. **Sign in.** Type the username in different capitals (e.g. all lower case) and the right password: the Dashboard opens with your inspections as before.
5. **Stays signed in.** Close the app fully (swipe it away) and reopen: straight to the Dashboard.
6. **Offline.** Sign out (step 7), turn on airplane mode, reopen and sign in: it works. Turn airplane mode off.
7. **Sign out.** Settings: **Sign out** under the version. Tap it: the sign-in screen. Sign in again: it opens the **Dashboard** (not Settings), and your inspections are all still there.
8. **Other devices.** On a phone and on the PC, open the link: each asks to sign in once, then stays signed in.
