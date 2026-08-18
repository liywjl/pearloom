import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { join } from "node:path";
import { userInfo } from "node:os";
import Corestore from "corestore";
import Hyperswarm from "hyperswarm";
import Hyperdrive from "hyperdrive";
import Autobase from "autobase";
import BlindPairing from "blind-pairing";
import ServeDrive from "serve-drive";
import z32 from "z32";
import b4a from "b4a";
import { Space } from "./space";
import type { RecordingStore } from "../recordings";
import type {
  CommentRecord,
  MemberInfo,
  Profile,
  ReactionRecord,
  SharedRecording,
  SpaceInfo,
} from "../../shared/types";

interface EngineOptions {
  storageDir: string;
  cacheDir: string;
  recordings: RecordingStore;
  /** DHT bootstrap nodes — only overridden in tests (local testnet). */
  bootstrap?: { host: string; port: number }[];
}

interface PersistedSpace {
  localId: string;
  keyHex: string;
  encryptionKeyHex: string | null;
  creator: boolean;
}

const PAIRING_TIMEOUT_MS = 90_000;

/**
 * The P2P data plane: one Corestore + one Hyperswarm shared by every space.
 * Every swarm connection replicates the whole store, so autobases and drives
 * across all spaces sync over the same sockets.
 */
export class P2PEngine extends EventEmitter {
  closing = false;
  private readonly opts: EngineOptions;
  private store: any;
  private swarm: any;
  private pairing: any;
  private serve: any;
  private readonly spaces = new Map<string, Space>(); // by localId
  private readonly remoteDrives = new Map<string, any>(); // by drive key hex
  private profile: Profile = { name: userInfo().username || "anonymous" };
  private profilePath = "";
  private spacesPath = "";

  constructor(opts: EngineOptions) {
    super();
    this.opts = opts;
  }

  async ready(): Promise<void> {
    await mkdir(this.opts.storageDir, { recursive: true });
    this.profilePath = join(this.opts.storageDir, "profile.json");
    this.spacesPath = join(this.opts.storageDir, "spaces.json");

    try {
      this.profile = JSON.parse(await readFile(this.profilePath, "utf8"));
    } catch {
      /* first run */
    }

    this.store = new Corestore(join(this.opts.storageDir, "store"));
    await this.store.ready();

    this.swarm = new Hyperswarm(
      this.opts.bootstrap ? { bootstrap: this.opts.bootstrap } : {},
    );
    this.swarm.on("connection", (conn: any) => {
      this.store.replicate(conn);
      this.emit("peers-changed");
      conn.once("close", () => this.emit("peers-changed"));
    });

    this.pairing = new BlindPairing(this.swarm);

    this.serve = new ServeDrive({
      host: "127.0.0.1",
      anyPort: true,
      get: ({ key }: { key: any }) => this.getDriveByKey(key),
      release: () => {},
    });
    await this.serve.ready();

    // Reopen previously created/joined spaces.
    const persisted = await this.loadPersistedSpaces();
    for (const p of persisted) {
      try {
        await this.openSpace(p);
      } catch (err) {
        console.error(`failed to open space ${p.localId}:`, err);
      }
    }
  }

  // ---- profile -------------------------------------------------------------

  getProfile(): Profile {
    return this.profile;
  }

  async setProfile(profile: Profile): Promise<Profile> {
    this.profile = { name: profile.name.trim().slice(0, 80) || "anonymous" };
    await writeFile(this.profilePath, JSON.stringify(this.profile));
    for (const space of this.spaces.values()) {
      if (space.base.writable)
        await space.introduceSelf(this.profile.name).catch(() => {});
    }
    return this.profile;
  }

  // ---- spaces --------------------------------------------------------------

  private async openSpace(
    p: PersistedSpace,
    spaceName?: string,
  ): Promise<Space> {
    const ns = this.store.namespace(`space/${p.localId}`);
    const space = new Space(
      { store: ns, swarm: this.swarm, pairing: this.pairing },
      {
        localId: p.localId,
        key: p.keyHex ? b4a.from(p.keyHex, "hex") : null,
        encryptionKey: p.encryptionKeyHex
          ? b4a.from(p.encryptionKeyHex, "hex")
          : null,
        creator: p.creator,
      },
    );
    await space.ready(this.profile.name, spaceName);
    space.on("update", () => this.emit("space-updated", space.id));
    space.on("error", (err) => console.error(`space ${space.id}:`, err));
    this.spaces.set(p.localId, space);
    return space;
  }

  async createSpace(name: string): Promise<SpaceInfo> {
    const localId = randomUUID();
    const space = await this.openSpace(
      { localId, keyHex: "", encryptionKeyHex: null, creator: true },
      name.trim() || "Untitled space",
    );
    await this.persistSpaces();
    this.emit("spaces-changed");
    return space.info(this.connectedPeers(space));
  }

  async joinSpace(inviteCode: string): Promise<SpaceInfo> {
    const invite = z32.decode(inviteCode.trim());
    const localId = randomUUID();
    // A separate namespace instance for getLocalKey (it may close its store);
    // must match the namespace the Space's Autobase will live in — and never
    // `.session()`, which silently resets to the root namespace.
    const userData = await Autobase.getLocalKey(
      this.store.namespace(`space/${localId}`),
    );

    const candidate = this.pairing.addCandidate({
      invite,
      userData,
      onadd: () => {},
    });
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("pairing timed out — is the inviter online?")),
        PAIRING_TIMEOUT_MS,
      ).unref(),
    );
    let paired: { key: Buffer; encryptionKey: Buffer | null };
    try {
      await Promise.race([candidate.pairing, timeout]);
      paired = candidate.paired;
    } catch (err) {
      await candidate.close().catch(() => {});
      throw err;
    }

    const keyHex = b4a.toString(paired.key, "hex");
    const existing = [...this.spaces.values()].find((s) => s.keyHex === keyHex);
    if (existing) return existing.info(this.connectedPeers(existing));

    const space = await this.openSpace({
      localId,
      keyHex,
      encryptionKeyHex: paired.encryptionKey
        ? b4a.toString(paired.encryptionKey, "hex")
        : null,
      creator: false,
    });
    await this.persistSpaces();
    this.emit("spaces-changed");
    return space.info(this.connectedPeers(space));
  }

  async leaveSpace(spaceId: string): Promise<void> {
    const space = this.findSpace(spaceId);
    if (!space) return;
    this.spaces.delete(space.localId);
    await space.close();
    await this.persistSpaces();
    this.emit("spaces-changed");
  }

  listSpaces(): SpaceInfo[] {
    return [...this.spaces.values()].map((s) => s.info(this.connectedPeers(s)));
  }

  async createInvite(spaceId: string): Promise<string> {
    const space = this.mustFindSpace(spaceId);
    return space.createInvite();
  }

  async listMembers(spaceId: string): Promise<MemberInfo[]> {
    const space = this.mustFindSpace(spaceId);
    return space.listMembers();
  }

  // ---- sharing recordings ----------------------------------------------------

  async publishRecording(
    recordingId: string,
    spaceId: string,
  ): Promise<SharedRecording> {
    const space = this.mustFindSpace(spaceId);
    const meta = this.opts.recordings.get(recordingId);
    if (!meta) throw new Error(`unknown recording ${recordingId}`);
    if (!space.base.writable)
      throw new Error("not yet writable in this space — wait for sync");

    const drivePath = `/recordings/${meta.id}.webm`;
    const existing = await space.drive.entry(drivePath);
    if (!existing) {
      await pipeline(
        createReadStream(this.opts.recordings.filePath(meta.id)),
        space.drive.createWriteStream(drivePath, {
          metadata: { type: meta.mimeType },
        }),
      );
    }
    const rec = await space.publish({
      id: meta.id,
      title: meta.title,
      createdAt: meta.createdAt,
      durationMs: meta.durationMs,
      sizeBytes: meta.sizeBytes,
      mimeType: meta.mimeType,
      ownerName: this.profile.name,
      drivePath,
      activity: meta.activity ?? [],
      tags: meta.tags ?? [],
    });
    await this.opts.recordings.markShared(meta.id, space.id);
    this.emit("space-updated", space.id);
    return rec;
  }

  async listShared(spaceId: string): Promise<SharedRecording[]> {
    const space = this.mustFindSpace(spaceId);
    return space.listRecordings();
  }

  /** HTTP URL (localhost, token-authed, Range-capable) for progressive playback. */
  playbackUrl(spaceId: string, driveKeyHex: string, drivePath: string): string {
    this.mustFindSpace(spaceId);
    return this.serve.getLink(drivePath, {
      key: z32.encode(b4a.from(driveKeyHex, "hex")),
    });
  }

  private async getDriveByKey(key: any): Promise<any> {
    const keyBuf: Buffer = b4a.isBuffer(key)
      ? key
      : typeof key === "string" && key.length === 64
        ? b4a.from(key, "hex")
        : z32.decode(String(key));
    const keyHex = b4a.toString(keyBuf, "hex");

    for (const space of this.spaces.values()) {
      if (space.drive && b4a.toString(space.drive.key, "hex") === keyHex)
        return space.drive;
    }
    let drive = this.remoteDrives.get(keyHex);
    if (!drive) {
      drive = new Hyperdrive(this.store.session(), keyBuf);
      await drive.ready();
      this.remoteDrives.set(keyHex, drive);
    }
    // A fresh sparse drive knows nothing yet — wait until connected peers have
    // had a chance to announce its current version, or entry() 404s.
    const done = (drive as any).findingPeers();
    this.swarm.flush().then(done, done);
    await (drive as any).update({ wait: true }).catch(() => {});
    return drive;
  }

  // ---- comments ---------------------------------------------------------------

  async addComment(
    spaceId: string,
    input: {
      recordingId: string;
      text: string;
      atMs: number | null;
      endMs: number | null;
    },
  ): Promise<CommentRecord> {
    const space = this.mustWritableSpace(spaceId);
    const comment = await space.addComment({
      ...input,
      author: this.profile.name,
    });
    this.emit("space-updated", space.id);
    return comment;
  }

  async listComments(
    spaceId: string,
    recordingId: string,
  ): Promise<CommentRecord[]> {
    const space = this.mustFindSpace(spaceId);
    return space.listComments(recordingId);
  }

  async setCommentLike(
    spaceId: string,
    recordingId: string,
    commentId: string,
    on: boolean,
  ): Promise<void> {
    const space = this.mustWritableSpace(spaceId);
    await space.setCommentLike(recordingId, commentId, on);
    this.emit("space-updated", space.id);
  }

  async addReaction(
    spaceId: string,
    input: { recordingId: string; emoji: string; atMs: number },
  ): Promise<ReactionRecord> {
    const space = this.mustWritableSpace(spaceId);
    const reaction = await space.addReaction({
      ...input,
      author: this.profile.name,
    });
    this.emit("space-updated", space.id);
    return reaction;
  }

  async listReactions(
    spaceId: string,
    recordingId: string,
  ): Promise<ReactionRecord[]> {
    const space = this.mustFindSpace(spaceId);
    return space.listReactions(recordingId);
  }

  private mustWritableSpace(spaceId: string): Space {
    const space = this.mustFindSpace(spaceId);
    if (!space.base.writable)
      throw new Error("not yet writable in this space — wait for sync");
    return space;
  }

  // ---- misc ---------------------------------------------------------------------

  private connectedPeers(space: Space): number {
    const peers = space.base?.view?.core?.peers;
    if (Array.isArray(peers)) return peers.length;
    return this.swarm?.connections?.size ?? 0;
  }

  private findSpace(spaceId: string): Space | null {
    for (const space of this.spaces.values())
      if (space.id === spaceId) return space;
    return null;
  }

  private mustFindSpace(spaceId: string): Space {
    const space = this.findSpace(spaceId);
    if (!space) throw new Error(`unknown space ${spaceId}`);
    return space;
  }

  private async loadPersistedSpaces(): Promise<PersistedSpace[]> {
    try {
      return JSON.parse(await readFile(this.spacesPath, "utf8"));
    } catch {
      return [];
    }
  }

  private async persistSpaces(): Promise<void> {
    const list: PersistedSpace[] = [...this.spaces.values()].map((s) => ({
      localId: s.localId,
      keyHex: s.keyHex,
      encryptionKeyHex: s.encryptionKeyHex,
      creator: s.creator,
    }));
    // Atomic write: this file holds the space keys — a crash mid-write would
    // otherwise silently lose every space on the next load.
    const tmp = `${this.spacesPath}.tmp`;
    await writeFile(tmp, JSON.stringify(list, null, 2));
    await rename(tmp, this.spacesPath);
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    for (const space of this.spaces.values())
      await space.close().catch(() => {});
    await this.serve?.close().catch(() => {});
    await this.pairing?.close().catch(() => {});
    await this.swarm?.destroy().catch(() => {});
    await this.store?.close().catch(() => {});
  }
}
