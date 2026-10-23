/**
 * The slide images of the Start lecture form, uploaded in the background as soon as each page
 * is made (Marko, hand test 2: "Start lecture, and then it uploads again, which kind of sucks").
 *
 * Every image goes into one folder named after the lecture id the form will start with
 * (`<lecture id>/<n>.webp` or `.jpg`, what the storage policy and start_lecture accept). n is a
 * new number for every upload, in the order the pages arrive, so a PDF picked alone gets 1 to N
 * and nothing ever lands on a name that is already taken (an upload that failed may have landed
 * after all; Replace and Add another PDF add their own numbers). start_lecture is then given the
 * slides in the order shown, each with the path its image went to.
 *
 * Images of a PDF that is removed or replaced are taken back out right away, including one that
 * finishes uploading after that. Images of a form that is never started stay until the day old
 * cleanup (my_orphan_slide_images) the next time a Start lecture page opens.
 */

/** Puts one image in storage; throws when it did not go up. */
export type StoreUpload = (path: string, image: Blob) => Promise<void>;
/** Takes images back out of storage, best effort (it never throws). */
export type StoreRemove = (paths: string[]) => void;

export type UploadProgress = {
  /** Images in storage. */
  done: number;
  /** Pages in the PDF, 0 until known. */
  total: number;
  /** Images that did not go up (after one quiet retry); Start lecture tries them again. */
  failed: number;
  /** Queued or on their way. */
  pending: number;
};

type Batch = {
  key: number;
  images: (Blob | undefined)[];
  paths: (string | undefined)[];
  failed: Set<number>;
  total: number;
  pending: number;
  /** Removed or replaced: whatever it put up is taken back out, also what lands later. */
  discarded: boolean;
};

type Item = { batch: Batch; index: number; path: string; tries: number };

/** Paths per Storage remove call. */
const REMOVE_BATCH = 100;

/** One quiet retry in the background; after that Start lecture asks again. */
const BACKGROUND_TRIES = 2;

const extension = (image: Blob) => (image.type === "image/webp" ? "webp" : "jpg");

export class SlideUploads {
  private folder: string;
  private number = 0;
  private queue: Item[] = [];
  private running = 0;
  private batches = new Map<number, Batch>();
  private waiters = new Set<() => void>();

  constructor(
    private readonly store: { upload: StoreUpload; remove: StoreRemove },
    private readonly onChange: () => void,
    private readonly parallel = 4,
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {
    this.folder = newId();
  }

  /** The id the lecture will get: every image is uploaded into its folder. */
  get lectureId(): string {
    return this.folder;
  }

  /** A new run for this PDF. Whatever an earlier run of the same key put up goes. */
  begin(key: number): void {
    this.discard(key);
    this.batches.set(key, { key, images: [], paths: [], failed: new Set(), total: 0, pending: 0, discarded: false });
  }

  /** The page count, once the PDF says it. */
  setTotal(key: number, total: number): void {
    const batch = this.batches.get(key);
    if (!batch || batch.total === total) return;
    batch.total = total;
    this.onChange();
  }

  /** One page's image: queued for upload unless it already is. */
  add(key: number, index: number, image: Blob): void {
    const batch = this.batches.get(key);
    if (!batch || batch.images[index]) return;
    batch.images[index] = image;
    this.enqueue(batch, index, 0);
    this.pump();
    this.onChange();
  }

  /** The PDF went (Remove, a Replace that worked, a file that could not be read): its images go too. */
  discard(key: number): void {
    const batch = this.batches.get(key);
    if (!batch) return;
    this.batches.delete(key);
    batch.discarded = true;
    const queued = this.queue.filter((item) => item.batch === batch).length;
    this.queue = this.queue.filter((item) => item.batch !== batch);
    batch.pending -= queued;
    const paths = batch.paths.filter((p): p is string => typeof p === "string");
    batch.paths = [];
    this.removeAll(paths);
    this.notify();
    this.onChange();
  }

  progress(key: number): UploadProgress {
    const batch = this.batches.get(key);
    if (!batch) return { done: 0, total: 0, failed: 0, pending: 0 };
    const done = batch.paths.filter(Boolean).length;
    return { done, total: batch.total, failed: batch.failed.size, pending: batch.pending };
  }

  /** Every page of these PDFs is in storage. */
  complete(keys: number[]): boolean {
    return keys.every((key) => {
      const batch = this.batches.get(key);
      if (!batch || batch.total === 0) return false;
      for (let i = 0; i < batch.total; i++) if (!batch.paths[i]) return false;
      return true;
    });
  }

  /** The storage paths of one PDF's pages, in page order (once complete). */
  paths(key: number): string[] {
    return (this.batches.get(key)?.paths ?? []).filter((p): p is string => typeof p === "string");
  }

  /**
   * Start lecture: tries the failed images again and waits for every upload of these PDFs.
   * True when every page is in storage.
   */
  async settle(keys: number[]): Promise<boolean> {
    for (const key of keys) {
      const batch = this.batches.get(key);
      if (!batch) continue;
      for (const index of [...batch.failed]) {
        batch.failed.delete(index);
        this.enqueue(batch, index, 0);
      }
    }
    this.pump();
    this.onChange();
    await new Promise<void>((resolve) => {
      const check = () => {
        const idle = keys.every((key) => (this.batches.get(key)?.pending ?? 0) === 0);
        if (!idle) return;
        this.waiters.delete(check);
        resolve();
      };
      this.waiters.add(check);
      check();
    });
    return this.complete(keys);
  }

  /**
   * The database did not find the images (the day old cleanup took them, from a form left open
   * that long): everything goes up again under new numbers. What may be left of the old ones goes.
   */
  redo(keys: number[]): void {
    for (const key of keys) {
      const batch = this.batches.get(key);
      if (!batch) continue;
      const old = batch.paths.filter((p): p is string => typeof p === "string");
      batch.paths = [];
      batch.failed.clear();
      this.removeAll(old);
      batch.images.forEach((image, index) => {
        if (image) this.enqueue(batch, index, 0);
      });
    }
    this.pump();
    this.onChange();
  }

  /** The lecture started with these images: forget them (they are its slides now) and take a new id. */
  reset(): void {
    this.batches = new Map();
    this.queue = [];
    this.folder = this.newId();
    this.number = 0;
    this.notify();
    this.onChange();
  }

  /** Storage takes a list; a long deck goes in calls of 100, as elsewhere in the app. */
  private removeAll(paths: string[]): void {
    for (let i = 0; i < paths.length; i += REMOVE_BATCH) this.store.remove(paths.slice(i, i + REMOVE_BATCH));
  }

  private enqueue(batch: Batch, index: number, tries: number): void {
    const image = batch.images[index];
    if (!image) return;
    this.queue.push({ batch, index, tries, path: `${this.folder}/${++this.number}.${extension(image)}` });
    batch.pending++;
  }

  private pump(): void {
    while (this.running < this.parallel && this.queue.length > 0) {
      const item = this.queue.shift()!;
      this.running++;
      void this.run(item);
    }
  }

  private async run(item: Item): Promise<void> {
    const { batch, index, path } = item;
    try {
      await this.store.upload(path, batch.images[index]!);
      if (batch.discarded) this.store.remove([path]);
      else batch.paths[index] = path;
    } catch {
      if (!batch.discarded) {
        if (item.tries + 1 < BACKGROUND_TRIES) this.enqueue(batch, index, item.tries + 1);
        else batch.failed.add(index);
      }
    } finally {
      this.running--;
      if (!batch.discarded) batch.pending--;
      this.pump();
      this.notify();
      this.onChange();
    }
  }

  private notify(): void {
    for (const check of [...this.waiters]) check();
  }
}
