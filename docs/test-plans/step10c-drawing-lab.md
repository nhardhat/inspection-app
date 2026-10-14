# Manual test plan: drawing lab (background drawing experiment)

Device: iPad [model], iPadOS [version]
Build/commit:
Tester / date:

Reply with the step number and what you saw, and paste the lab's **Copy results** text (it never includes drawing names). This decides whether drawing on a background thread can replace drawing on the main thread in the drawings screen.

1. **Open the lab.** Settings, Drawing: with **Show diagnostics** on, a **Drawing lab** link shows under it. Tap it.
2. **Pick the slow sheet.** Choose the B1 drawing set and the busy page (hatching), zoom **2× fit**.
3. **Main thread.** Tap **Draw on main thread** and watch the red bar: it stalls while the page draws (that's the lag you feel in the drawings). A line appears with the time and the longest freeze.
4. **Background.** Tap **Draw in background**. Does the bar keep moving smoothly the whole time? Does a picture of the page appear below (or does the line say FAILED, and with what message)?
5. **Same picture.** Compare the two pictures (scroll the box below): same linework, hatching and text? Note anything missing or different (shading, text, colours).
6. **More zoom.** Repeat 3 and 4 at **4×** and **8×** fit.
7. **Copy.** Tap **Copy results** and paste them here.
