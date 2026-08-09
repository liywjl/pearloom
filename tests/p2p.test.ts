import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error no types — hyperdht ships none
import createTestnet from "hyperdht/testnet";
import { P2PEngine } from "../src/main/p2p/engine";
import { RecordingStore } from "../src/main/recordings";

/**
 * Full two-peer flow over a local DHT testnet:
 * Alice records + shares into a space, invites Bob; Bob joins, streams the
 * video over the local HTTP gateway, and both exchange comments.
 */
describe("P2P sharing end-to-end", () => {
  let testnet: any;
  let dirs: string[] = [];
  let alice: P2PEngine;
  let bob: P2PEngine;
  let aliceRecordings: RecordingStore;
  const videoBytes = Buffer.from("FAKE-WEBM-" + "x".repeat(4096));

  const makePeer = async (name: string) => {
    const dir = await mkdtemp(join(tmpdir(), `pearloom-${name}-`));
    dirs.push(dir);
    const recordings = new RecordingStore(join(dir, "recordings"));
    await recordings.ready();
    const engine = new P2PEngine({
      storageDir: join(dir, "p2p"),
      cacheDir: join(dir, "cache"),
      recordings,
      bootstrap: testnet.bootstrap,
    });
    await engine.ready();
    await engine.setProfile({ name });
    return { engine, recordings };
  };

  beforeAll(async () => {
    testnet = await createTestnet(3);
    const a = await makePeer("alice");
    alice = a.engine;
    aliceRecordings = a.recordings;
    const b = await makePeer("bob");
    bob = b.engine;
  }, 60_000);

  afterAll(async () => {
    await alice?.close();
    await bob?.close();
    await testnet?.destroy();
    for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  }, 60_000);

  it("shares a recording, pairs a peer, streams the blob, and syncs comments", async () => {
    // Alice records something.
    const draft = aliceRecordings.begin("Design walkthrough", "video/webm");
    await aliceRecordings.appendChunk(draft.id, videoBytes);
    const rec = await aliceRecordings.finalize(draft.id, {
      durationMs: 60_000,
      thumbnailDataUrl: null,
      activity: [
        { kind: "click", atMs: 2_000 },
        { kind: "typing", atMs: 10_000, endMs: 14_000 },
      ],
    });

    await aliceRecordings.setTags(rec.id, ["design", "walkthrough"]);

    // Alice creates a space and publishes into it.
    const space = await alice.createSpace("Design reviews");
    expect(space.writable).toBe(true);
    const published = await alice.publishRecording(rec.id, space.id);
    expect(published.mine).toBe(true);
    expect(aliceRecordings.get(rec.id)!.sharedTo).toEqual([space.id]);

    // Alice invites Bob; Bob pairs.
    const invite = await alice.createInvite(space.id);
    expect(invite.length).toBeGreaterThan(20);
    const joined = await bob.joinSpace(invite);
    expect(joined.id).toBe(space.id);

    // Bob sees the shared recording.
    const shared = await waitFor(async () => {
      const list = await bob.listShared(space.id);
      return list.length === 1 ? list : null;
    });
    expect(shared[0]!.title).toBe("Design walkthrough");
    expect(shared[0]!.ownerName).toBe("alice");
    expect(shared[0]!.mine).toBe(false);
    // The activity timeline and tags travel with the publication.
    expect(shared[0]!.activity).toEqual([
      { kind: "click", atMs: 2_000 },
      { kind: "typing", atMs: 10_000, endMs: 14_000 },
    ]);
    expect(shared[0]!.tags).toEqual(["design", "walkthrough"]);

    // Bob streams the video bytes over his local HTTP gateway (P2P underneath).
    const url = bob.playbackUrl(
      space.id,
      shared[0]!.driveKey,
      shared[0]!.drivePath,
    );
    const res = await fetch(url);
    expect(res.status).toBe(200);
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(videoBytes)).toBe(true);

    // Range requests work (video seeking).
    const partial = await fetch(url, { headers: { Range: "bytes=0-3" } });
    expect(partial.status).toBe(206);
    expect(Buffer.from(await partial.arrayBuffer()).toString()).toBe("FAKE");

    // Bob comments once his writer role has synced in.
    await waitFor(async () =>
      bob.listSpaces().find((s) => s.id === space.id)?.writable ? true : null,
    );
    await bob.addComment(space.id, {
      recordingId: rec.id,
      text: "Love the new sidebar! One nit at the intro.",
      atMs: 4_000,
      endMs: 9_500,
    });

    // Alice sees Bob's section comment; replies; Bob sees the reply.
    const aliceSees = await waitFor(async () => {
      const list = await alice.listComments(space.id, rec.id);
      return list.length === 1 ? list : null;
    });
    expect(aliceSees[0]!.author).toBe("bob");
    expect(aliceSees[0]!.atMs).toBe(4_000);
    expect(aliceSees[0]!.endMs).toBe(9_500);

    await alice.addComment(space.id, {
      recordingId: rec.id,
      text: "Fixed!",
      atMs: null,
      endMs: null,
    });
    const bobSees = await waitFor(async () => {
      const list = await bob.listComments(space.id, rec.id);
      return list.length === 2 ? list : null;
    });
    expect(bobSees.map((c) => c.author).sort()).toEqual(["alice", "bob"]);

    // Likes: Alice likes Bob's comment; both converge on the tally, and the
    // like is attributed to the signer (likedByMe differs per peer).
    const bobsComment = aliceSees[0]!;
    await alice.setCommentLike(space.id, rec.id, bobsComment.id, true);
    const bobSeesLike = await waitFor(async () => {
      const list = await bob.listComments(space.id, rec.id);
      const target = list.find((c) => c.id === bobsComment.id);
      return target && target.likeCount === 1 ? target : null;
    });
    expect(bobSeesLike.likedByMe).toBe(false);
    const aliceSeesLike = (await alice.listComments(space.id, rec.id)).find(
      (c) => c.id === bobsComment.id,
    )!;
    expect(aliceSeesLike.likedByMe).toBe(true);

    // Unlike converges too.
    await alice.setCommentLike(space.id, rec.id, bobsComment.id, false);
    await waitFor(async () => {
      const list = await bob.listComments(space.id, rec.id);
      const target = list.find((c) => c.id === bobsComment.id);
      return target && target.likeCount === 0 ? true : null;
    });

    // Emoji reactions anchored to moments sync both ways.
    await bob.addReaction(space.id, {
      recordingId: rec.id,
      emoji: "🎉",
      atMs: 12_000,
    });
    const aliceReactions = await waitFor(async () => {
      const list = await alice.listReactions(space.id, rec.id);
      return list.length === 1 ? list : null;
    });
    expect(aliceReactions[0]!.emoji).toBe("🎉");
    expect(aliceReactions[0]!.atMs).toBe(12_000);
    expect(aliceReactions[0]!.author).toBe("bob");

    // Member names propagated through the autobase.
    const spaces = bob.listSpaces();
    expect(spaces[0]!.name).toBe("Design reviews");

    // Both peers converge on the member registry (drives the reviewers UI).
    const bobMembers = await waitFor(async () => {
      const ms = await bob.listMembers(space.id);
      return ms.length === 2 ? ms : null;
    });
    expect(bobMembers.map((m) => m.name).sort()).toEqual(["alice", "bob"]);
    const aliceMembers = await waitFor(async () => {
      const ms = await alice.listMembers(space.id);
      return ms.length === 2 ? ms : null;
    });
    expect(aliceMembers.map((m) => m.name).sort()).toEqual(["alice", "bob"]);
  }, 120_000);
});

async function waitFor<T>(
  fn: () => Promise<T | null | undefined>,
  timeoutMs = 30_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await fn();
    if (result != null) return result;
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 250));
  }
}
