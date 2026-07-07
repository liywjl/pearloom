import { randomUUID } from "node:crypto";
import { createWriteStream, type WriteStream } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import type { FinalizeRecordingInput, RecordingMeta } from "../shared/types";

interface ActiveWrite {
  stream: WriteStream;
  meta: RecordingMeta;
}

/**
 * Local recording storage: one .webm per recording plus a JSON index.
 * Pure Node — no Electron imports — so it is unit-testable as-is.
 */
export class RecordingStore {
  private readonly dir: string;
  private readonly indexPath: string;
  private index: Map<string, RecordingMeta> = new Map();
  private active: Map<string, ActiveWrite> = new Map();
  private persisting: Promise<void> = Promise.resolve();

  private lastCreatedAt = 0;

  constructor(dir: string) {
    this.dir = dir;
    this.indexPath = join(dir, "index.json");
  }

  /** Monotonic timestamp so newest-first ordering is deterministic even for
   *  recordings created within the same millisecond. */
  private nextCreatedAt(): number {
    this.lastCreatedAt = Math.max(Date.now(), this.lastCreatedAt + 1);
    return this.lastCreatedAt;
  }

  async ready(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    try {
      const raw = await readFile(this.indexPath, "utf8");
      const entries = JSON.parse(raw) as RecordingMeta[];
      this.index = new Map(
        entries.map((m) => [
          m.id,
          { ...m, activity: m.activity ?? [], tags: m.tags ?? [] },
        ]),
      );
    } catch {
      this.index = new Map();
    }
    await this.recoverOrphans();
  }

  /**
   * Adopt .webm files that were mid-recording when the app died (chunks were
   * streamed to disk but finalize never ran), so no footage is ever lost.
   */
  private async recoverOrphans(): Promise<void> {
    let changed = false;
    for (const file of await readdir(this.dir)) {
      if (!file.endsWith(".webm")) continue;
      const id = file.slice(0, -".webm".length);
      if (this.index.has(id) || this.active.has(id)) continue;
      try {
        const info = await stat(join(this.dir, file));
        if (info.size === 0) {
          await rm(join(this.dir, file), { force: true });
          continue;
        }
        this.index.set(id, {
          id,
          title: `Recovered recording ${new Date(info.mtimeMs).toLocaleString()}`,
          createdAt: info.mtimeMs,
          durationMs: 0,
          sizeBytes: info.size,
          mimeType: "video/webm",
          thumbnailDataUrl: null,
          sharedTo: [],
          activity: [],
          tags: [],
        });
        changed = true;
      } catch {
        /* unreadable file — leave it alone */
      }
    }
    if (changed) await this.persist();
  }

  filePath(id: string): string {
    return join(this.dir, `${id}.webm`);
  }

  list(): RecordingMeta[] {
    return [...this.index.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  get(id: string): RecordingMeta | null {
    return this.index.get(id) ?? null;
  }

  /** Begin a new recording; chunks stream in via appendChunk until finalize. */
  begin(title: string, mimeType: string): RecordingMeta {
    const id = randomUUID();
    const meta: RecordingMeta = {
      id,
      title,
      createdAt: this.nextCreatedAt(),
      durationMs: 0,
      sizeBytes: 0,
      mimeType,
      thumbnailDataUrl: null,
      sharedTo: [],
      activity: [],
      tags: [],
    };
    const stream = createWriteStream(this.filePath(id));
    this.active.set(id, { stream, meta });
    return meta;
  }

  async appendChunk(id: string, chunk: Uint8Array): Promise<void> {
    const active = this.active.get(id);
    if (!active) throw new Error(`no active recording ${id}`);
    await new Promise<void>((resolve, reject) => {
      active.stream.write(chunk, (err) => (err ? reject(err) : resolve()));
    });
  }

  async finalize(
    id: string,
    input: FinalizeRecordingInput,
  ): Promise<RecordingMeta> {
    const active = this.active.get(id);
    if (!active) throw new Error(`no active recording ${id}`);
    this.active.delete(id);
    await new Promise<void>((resolve, reject) => {
      active.stream.end((err?: Error | null) =>
        err ? reject(err) : resolve(),
      );
    });
    const { size } = await stat(this.filePath(id));
    const meta: RecordingMeta = {
      ...active.meta,
      durationMs: input.durationMs,
      sizeBytes: size,
      thumbnailDataUrl: input.thumbnailDataUrl,
      activity: input.activity ?? [],
    };
    this.index.set(id, meta);
    await this.persist();
    return meta;
  }

  /** Abort an in-flight recording and remove its partial file. */
  async abort(id: string): Promise<void> {
    const active = this.active.get(id);
    if (!active) return;
    this.active.delete(id);
    await new Promise<void>((resolve) => active.stream.end(() => resolve()));
    await rm(this.filePath(id), { force: true });
  }

  async setTitle(id: string, title: string): Promise<RecordingMeta> {
    const meta = this.index.get(id);
    if (!meta) throw new Error(`unknown recording ${id}`);
    const updated = { ...meta, title };
    this.index.set(id, updated);
    await this.persist();
    return updated;
  }

  async setTags(id: string, tags: string[]): Promise<RecordingMeta> {
    const meta = this.index.get(id);
    if (!meta) throw new Error(`unknown recording ${id}`);
    const clean = [
      ...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean)),
    ].slice(0, 24);
    const updated = { ...meta, tags: clean };
    this.index.set(id, updated);
    await this.persist();
    return updated;
  }

  async markShared(id: string, spaceId: string): Promise<RecordingMeta> {
    const meta = this.index.get(id);
    if (!meta) throw new Error(`unknown recording ${id}`);
    const sharedTo = meta.sharedTo.includes(spaceId)
      ? meta.sharedTo
      : [...meta.sharedTo, spaceId];
    const updated = { ...meta, sharedTo };
    this.index.set(id, updated);
    await this.persist();
    return updated;
  }

  async remove(id: string): Promise<void> {
    this.index.delete(id);
    await rm(this.filePath(id), { force: true });
    await this.persist();
  }

  /** Serialized writes so concurrent updates can't interleave partial JSON. */
  private persist(): Promise<void> {
    this.persisting = this.persisting.then(async () => {
      const tmp = `${this.indexPath}.tmp`;
      await writeFile(tmp, JSON.stringify([...this.index.values()], null, 2));
      await rename(tmp, this.indexPath);
    });
    return this.persisting;
  }
}
