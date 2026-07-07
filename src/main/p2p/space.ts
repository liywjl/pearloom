import { EventEmitter } from "node:events";
import Autobase from "autobase";
import Hyperbee from "hyperbee";
import Hyperdrive from "hyperdrive";
import BlindPairing from "blind-pairing";
import z32 from "z32";
import b4a from "b4a";
import type {
  ActivityEvent,
  CommentRecord,
  ReactionRecord,
  SharedRecording,
  SpaceInfo,
} from "../../shared/types";

export interface SpaceContext {
  /** Corestore session namespaced for this space. */
  store: any;
  swarm: any;
  pairing: any;
}

export interface SpaceIdentity {
  localId: string;
  key: Buffer | null;
  encryptionKey: Buffer | null;
  creator: boolean;
}

interface PublishInput {
  id: string;
  title: string;
  createdAt: number;
  durationMs: number;
  sizeBytes: number;
  mimeType: string;
  ownerName: string;
  drivePath: string;
  activity: ActivityEvent[];
  tags: string[];
}

/**
 * A share space: one multi-writer Autobase whose view is a Hyperbee.
 *
 * Bee layout (all writes flow through `apply` so every member converges):
 *   meta                                     -> { name }
 *   invite                                   -> { id, invite, publicKey, expires } (hex fields)
 *   member!<writerKeyHex>                    -> { name, addedAt }
 *   rec!<recordingId>                        -> published recording record
 *   comment!<recordingId>!<paddedTs>!<id>    -> comment record
 *   clike!<recordingId>!<commentId>!<writer> -> {} (a like on a comment; keyed
 *                                               by the SIGNING writer, so likes
 *                                               can't be forged or duplicated)
 *   react!<recordingId>!<paddedAtMs>!<writer>!<id> -> emoji reaction at a moment
 *
 * Each member also owns a per-space Hyperdrive holding the video blobs they
 * publish; the drive key travels inside the `rec!` records.
 */
export class Space extends EventEmitter {
  readonly localId: string;
  readonly creator: boolean;
  private readonly ctx: SpaceContext;
  readonly base: any;
  drive: any = null;
  private member: any = null;
  private discovery: any = null;
  private swarmConnHandler: ((conn: any) => void) | null = null;
  private name = "Untitled space";

  constructor(ctx: SpaceContext, identity: SpaceIdentity) {
    super();
    this.ctx = ctx;
    this.localId = identity.localId;
    this.creator = identity.creator;
    this.base = new Autobase(ctx.store.session(), identity.key, {
      open: (viewStore: any) =>
        new Hyperbee(viewStore.get("view"), {
          extension: false,
          keyEncoding: "utf-8",
          valueEncoding: "json",
        }),
      apply: Space.applyNodes,
      valueEncoding: "json",
      ...(identity.key
        ? { encryptionKey: identity.encryptionKey }
        : { encrypt: true }),
    });
  }

  /** Deterministic reducer — no I/O, no clocks, no randomness. */
  private static async applyNodes(
    nodes: any[],
    view: any,
    host: any,
  ): Promise<void> {
    for (const node of nodes) {
      const value = node.value;
      if (!value || typeof value !== "object") continue;
      switch (value.type) {
        case "add-writer":
          await host.addWriter(b4a.from(value.key, "hex"), { indexer: true });
          break;
        case "meta":
          await view.put("meta", { name: value.name });
          break;
        case "add-invite":
          await view.put("invite", {
            id: value.id,
            invite: value.invite,
            publicKey: value.publicKey,
            expires: value.expires,
          });
          break;
        case "member":
          await view.put(`member!${value.key}`, {
            name: value.name,
            addedAt: value.addedAt,
          });
          break;
        case "publish":
          await view.put(`rec!${value.rec.id}`, value.rec);
          break;
        case "comment": {
          const c = value.comment;
          const ts = String(c.createdAt).padStart(16, "0");
          await view.put(`comment!${c.recordingId}!${ts}!${c.id}`, c);
          break;
        }
        case "comment-like": {
          // Keyed by the writer that signed the block — one like per member,
          // and nobody can like (or unlike) on someone else's behalf.
          const writer = b4a.toString(node.from.key, "hex");
          const key = `clike!${value.recordingId}!${value.commentId}!${writer}`;
          if (value.on) await view.put(key, { at: value.at });
          else await view.del(key);
          break;
        }
        case "reaction": {
          const r = value.reaction;
          const writer = b4a.toString(node.from.key, "hex");
          const at = String(r.atMs).padStart(16, "0");
          await view.put(`react!${r.recordingId}!${at}!${writer}!${r.id}`, {
            ...r,
            authorKey: writer,
          });
          break;
        }
      }
    }
  }

  async ready(profileName: string, spaceName?: string): Promise<void> {
    await this.base.ready();

    // Per-member per-space drive for the video blobs this member publishes.
    this.drive = new Hyperdrive(this.ctx.store.namespace("drive").session());
    await this.drive.ready();

    if (this.creator && spaceName) {
      await this.base.append({ type: "meta", name: spaceName });
    }
    if (this.base.writable) {
      await this.introduceSelf(profileName);
    }

    this.base.on("update", () => {
      this.refreshName().catch(() => {});
      // Joiners become writable only once their writer-add syncs in.
      if (this.base.writable && !this.introduced) {
        this.introduceSelf(profileName).catch(() => {});
      }
      this.emit("update");
    });
    await this.refreshName();

    // Announce + look up members of this space.
    this.discovery = this.ctx.swarm.join(this.base.discoveryKey);

    // Answer pairing requests from invited peers (any writable member can).
    this.member = this.ctx.pairing.addMember({
      discoveryKey: this.base.discoveryKey,
      onadd: async (candidate: any) => {
        try {
          await this.base.update();
          const node = await this.base.view.get("invite");
          if (!node?.value) return;
          if (
            candidate.inviteId &&
            node.value.id !== b4a.toString(candidate.inviteId, "hex")
          )
            return;
          candidate.open(b4a.from(node.value.publicKey, "hex"));
          await this.base.append({
            type: "add-writer",
            key: b4a.toString(candidate.userData, "hex"),
          });
          candidate.confirm({
            key: this.base.key,
            encryptionKey: this.base.encryptionKey,
          });
        } catch (err) {
          this.emit("error", err);
        }
      },
    });
  }

  private async refreshName(): Promise<void> {
    const node = await this.base.view.get("meta").catch(() => null);
    if (node?.value?.name) this.name = node.value.name;
  }

  private introducedAs: string | null = null;

  get introduced(): boolean {
    return this.introducedAs !== null;
  }

  async introduceSelf(profileName: string): Promise<void> {
    if (this.introducedAs === profileName) return;
    const previous = this.introducedAs;
    this.introducedAs = profileName;
    try {
      const key = b4a.toString(this.base.local.key, "hex");
      const existing = await this.base.view
        .get(`member!${key}`)
        .catch(() => null);
      if (existing?.value?.name === profileName) return;
      await this.base.append({
        type: "member",
        key,
        name: profileName,
        addedAt: Date.now(),
      });
    } catch (err) {
      this.introducedAs = previous;
      throw err;
    }
  }

  get id(): string {
    return z32.encode(this.base.key);
  }

  get encryptionKeyHex(): string | null {
    return this.base.encryptionKey
      ? b4a.toString(this.base.encryptionKey, "hex")
      : null;
  }

  get keyHex(): string {
    return b4a.toString(this.base.key, "hex");
  }

  info(connectedPeers: number): SpaceInfo {
    return {
      id: this.id,
      name: this.name,
      writable: !!this.base.writable,
      isCreator: this.creator,
      connectedPeers,
    };
  }

  /** Create (or reuse) an invite others can join with. Returns a z32 code. */
  async createInvite(): Promise<string> {
    await this.base.update();
    const existing = await this.base.view.get("invite").catch(() => null);
    if (
      existing?.value &&
      (!existing.value.expires || existing.value.expires > Date.now())
    ) {
      return z32.encode(b4a.from(existing.value.invite, "hex"));
    }
    const { id, invite, publicKey, expires } = BlindPairing.createInvite(
      this.base.key,
    );
    await this.base.append({
      type: "add-invite",
      id: b4a.toString(id, "hex"),
      invite: b4a.toString(invite, "hex"),
      publicKey: b4a.toString(publicKey, "hex"),
      expires,
    });
    return z32.encode(invite);
  }

  /** Publish a recording: the caller must already have written the blob to `drive`. */
  async publish(input: PublishInput): Promise<SharedRecording> {
    const rec = {
      id: input.id,
      title: input.title,
      createdAt: input.createdAt,
      durationMs: input.durationMs,
      sizeBytes: input.sizeBytes,
      mimeType: input.mimeType,
      ownerName: input.ownerName,
      ownerKey: b4a.toString(this.base.local.key, "hex"),
      driveKey: b4a.toString(this.drive.key, "hex"),
      drivePath: input.drivePath,
      activity: input.activity,
      tags: input.tags,
    };
    await this.base.append({ type: "publish", rec });
    return { ...rec, spaceId: this.id, mine: true, available: true };
  }

  async listRecordings(): Promise<SharedRecording[]> {
    await this.base.update();
    const myDriveKey = b4a.toString(this.drive.key, "hex");
    const out: SharedRecording[] = [];
    for await (const node of this.base.view.createReadStream({
      gte: "rec!",
      lt: "rec!~",
    })) {
      const rec = node.value;
      out.push({
        activity: [], // defaults for records published by older versions
        tags: [],
        ...rec,
        spaceId: this.id,
        mine: rec.driveKey === myDriveKey,
        available: rec.driveKey === myDriveKey,
      });
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }

  async addComment(input: {
    recordingId: string;
    author: string;
    text: string;
    atMs: number | null;
    endMs: number | null;
  }): Promise<CommentRecord> {
    const comment = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      spaceId: this.id,
      recordingId: input.recordingId,
      author: input.author,
      authorKey: b4a.toString(this.base.local.key, "hex"),
      text: input.text,
      atMs: input.atMs,
      endMs: input.endMs,
      createdAt: Date.now(),
    };
    await this.base.append({ type: "comment", comment });
    return { ...comment, likeCount: 0, likedByMe: false };
  }

  async listComments(recordingId: string): Promise<CommentRecord[]> {
    await this.base.update();

    // Gather like tallies first: clike!<recId>!<commentId>!<writer>
    const likes = new Map<string, Set<string>>();
    const likePrefix = `clike!${recordingId}!`;
    for await (const node of this.base.view.createReadStream({
      gte: likePrefix,
      lt: `${likePrefix}~`,
    })) {
      const [, , commentId, writer] = node.key.split("!");
      if (!commentId || !writer) continue;
      if (!likes.has(commentId)) likes.set(commentId, new Set());
      likes.get(commentId)!.add(writer);
    }

    const me = b4a.toString(this.base.local.key, "hex");
    const out: CommentRecord[] = [];
    const prefix = `comment!${recordingId}!`;
    for await (const node of this.base.view.createReadStream({
      gte: prefix,
      lt: `${prefix}~`,
    })) {
      const likers = likes.get(node.value.id) ?? new Set<string>();
      out.push({
        endMs: null, // default for records written before sections existed
        ...node.value,
        spaceId: this.id,
        likeCount: likers.size,
        likedByMe: likers.has(me),
      });
    }
    return out;
  }

  async setCommentLike(
    recordingId: string,
    commentId: string,
    on: boolean,
  ): Promise<void> {
    await this.base.append({
      type: "comment-like",
      recordingId,
      commentId,
      on,
      at: Date.now(),
    });
  }

  async addReaction(input: {
    recordingId: string;
    emoji: string;
    atMs: number;
    author: string;
  }): Promise<ReactionRecord> {
    const reaction = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      recordingId: input.recordingId,
      emoji: input.emoji,
      atMs: Math.max(0, Math.round(input.atMs)),
      author: input.author,
      createdAt: Date.now(),
    };
    await this.base.append({ type: "reaction", reaction });
    return {
      ...reaction,
      spaceId: this.id,
      authorKey: b4a.toString(this.base.local.key, "hex"),
    };
  }

  async listMembers(): Promise<
    { key: string; name: string; addedAt: number }[]
  > {
    await this.base.update();
    const out: { key: string; name: string; addedAt: number }[] = [];
    for await (const node of this.base.view.createReadStream({
      gte: "member!",
      lt: "member!~",
    })) {
      out.push({
        key: node.key.slice("member!".length),
        name: node.value?.name ?? "member",
        addedAt: node.value?.addedAt ?? 0,
      });
    }
    return out.sort((a, b) => a.addedAt - b.addedAt);
  }

  async listReactions(recordingId: string): Promise<ReactionRecord[]> {
    await this.base.update();
    const out: ReactionRecord[] = [];
    const prefix = `react!${recordingId}!`;
    for await (const node of this.base.view.createReadStream({
      gte: prefix,
      lt: `${prefix}~`,
    })) {
      out.push({ ...node.value, spaceId: this.id });
    }
    return out;
  }

  async close(): Promise<void> {
    await this.member?.close().catch(() => {});
    await this.discovery?.destroy().catch(() => {});
    await this.drive?.close().catch(() => {});
    await this.base.close().catch(() => {});
  }
}
