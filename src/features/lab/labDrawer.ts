import type {
  DrawJob,
  DrawerRequest,
  DrawerResponse,
} from "../drawings/document/drawingWorker";

/**
 * A drawing worker of the lab's own (the same one the drawings screen
 * uses), so the lab can run two side by side: does drawing two areas at
 * once on this iPad take less time than one after the other?
 */
export class LabDrawer {
  private worker: Worker;
  private ids = 0;
  private waiting = new Map<
    number,
    {
      resolve: (bitmap: ImageBitmap | null) => void;
      reject: (e: Error) => void;
    }
  >();
  readonly ready: Promise<void>;

  constructor() {
    this.worker = new Worker(
      new URL("../drawings/document/drawingWorker.ts", import.meta.url),
      { type: "module" },
    );
    let started: () => void = () => {};
    let failed: (e: Error) => void = () => {};
    this.ready = new Promise((resolve, reject) => {
      started = resolve;
      failed = reject;
    });
    this.worker.onerror = (e) => {
      const error = new Error(e.message || "Worker failed");
      failed(error);
      for (const w of this.waiting.values()) w.reject(error);
      this.waiting.clear();
    };
    this.worker.onmessage = (e: MessageEvent<DrawerResponse>) => {
      const msg = e.data;
      if (msg.type === "ready") {
        if (msg.ok) started();
        else failed(new Error("This browser can't draw in the background"));
        return;
      }
      const w = this.waiting.get(msg.id);
      if (!w) return;
      this.waiting.delete(msg.id);
      if (msg.type === "image") w.resolve(msg.bitmap);
      else if (msg.type === "png") w.resolve(null);
      else w.reject(new Error(msg.message));
    };
  }

  open(drawingId: string, data: ArrayBuffer) {
    this.worker.postMessage(
      { type: "open", drawingId, data } satisfies DrawerRequest,
      [data],
    );
  }

  /** The picture (or null when none was asked for). */
  draw(job: DrawJob): Promise<ImageBitmap | null> {
    const id = ++this.ids;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.worker.postMessage({
        type: "draw",
        id,
        ...job,
      } satisfies DrawerRequest);
    });
  }

  close() {
    this.worker.terminate();
  }
}
