import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RecordingStore } from "../src/main/recordings";

describe("RecordingStore", () => {
  let dir: string;
  let store: RecordingStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pearloom-rec-"));
    store = new RecordingStore(dir);
    await store.ready();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const record = async (
    title = "Test",
    chunks = [Buffer.from("abc"), Buffer.from("defg")],
  ) => {
    const meta = store.begin(title, "video/webm");
    for (const c of chunks) await store.appendChunk(meta.id, c);
    return store.finalize(meta.id, {
      durationMs: 1234,
      thumbnailDataUrl: null,
      activity: [
        { kind: "click", atMs: 100 },
        { kind: "typing", atMs: 400, endMs: 900 },
      ],
    });
  };

  it("writes chunks to disk and records size + duration", async () => {
    const meta = await record();
    expect(meta.sizeBytes).toBe(7);
    expect(meta.durationMs).toBe(1234);
    const file = await readFile(store.filePath(meta.id));
    expect(file.toString()).toBe("abcdefg");
  });

  it("persists the activity track across reload", async () => {
    const meta = await record();
    const reloaded = new RecordingStore(dir);
    await reloaded.ready();
    expect(reloaded.get(meta.id)!.activity).toEqual([
      { kind: "click", atMs: 100 },
      { kind: "typing", atMs: 400, endMs: 900 },
    ]);
  });

  it("lists newest first and survives reload", async () => {
    const a = await record("first");
    const b = await record("second");
    expect(store.list().map((m) => m.id)).toEqual([b.id, a.id]);

    const reloaded = new RecordingStore(dir);
    await reloaded.ready();
    expect(
      reloaded
        .list()
        .map((m) => m.title)
        .sort(),
    ).toEqual(["first", "second"]);
  });

  it("normalizes and persists tags", async () => {
    const meta = await record();
    await store.setTags(meta.id, ["  Design ", "demo", "design", ""]);
    expect(store.get(meta.id)!.tags).toEqual(["design", "demo"]);

    const reloaded = new RecordingStore(dir);
    await reloaded.ready();
    expect(reloaded.get(meta.id)!.tags).toEqual(["design", "demo"]);
  });

  it("renames and marks shared idempotently", async () => {
    const meta = await record();
    await store.setTitle(meta.id, "Renamed");
    await store.markShared(meta.id, "space-1");
    await store.markShared(meta.id, "space-1");
    const found = store.get(meta.id)!;
    expect(found.title).toBe("Renamed");
    expect(found.sharedTo).toEqual(["space-1"]);
  });

  it("removes file and index entry", async () => {
    const meta = await record();
    await store.remove(meta.id);
    expect(store.get(meta.id)).toBeNull();
    await expect(readFile(store.filePath(meta.id))).rejects.toThrow();
  });

  it("abort discards the partial file", async () => {
    const meta = store.begin("junk", "video/webm");
    await store.appendChunk(meta.id, Buffer.from("partial"));
    await store.abort(meta.id);
    expect(store.get(meta.id)).toBeNull();
    await expect(readFile(store.filePath(meta.id))).rejects.toThrow();
  });

  it("rejects chunks for unknown recordings", async () => {
    await expect(store.appendChunk("nope", Buffer.from("x"))).rejects.toThrow(
      /no active/,
    );
  });

  it("recovers orphaned recordings on startup (app died mid-recording)", async () => {
    // Simulate a crash: chunks hit disk, finalize never runs.
    const meta = store.begin("doomed", "video/webm");
    await store.appendChunk(meta.id, Buffer.from("salvage-me"));
    // No finalize, no abort — a new store instance starts over the same dir.

    const reborn = new RecordingStore(dir);
    await reborn.ready();
    const recovered = reborn.get(meta.id);
    expect(recovered).not.toBeNull();
    expect(recovered!.title).toMatch(/^Recovered recording/);
    expect(recovered!.sizeBytes).toBe(10);
    const file = await readFile(reborn.filePath(meta.id));
    expect(file.toString()).toBe("salvage-me");
  });

  it("does not adopt empty orphan files", async () => {
    const meta = store.begin("empty", "video/webm");
    const reborn = new RecordingStore(dir);
    await reborn.ready();
    expect(reborn.get(meta.id)).toBeNull();
  });
});
