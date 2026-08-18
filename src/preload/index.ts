import { contextBridge, ipcRenderer } from "electron";
import type {
  CommentRecord,
  CursorPos,
  DisplaySource,
  FinalizeRecordingInput,
  GlobalClick,
  MediaAccessKind,
  MediaAccessStatus,
  MemberInfo,
  Profile,
  QuickRecStart,
  ReactionRecord,
  RecordingMeta,
  SharedRecording,
  SpaceInfo,
} from "../shared/types";

const api = {
  capture: {
    sources: (): Promise<DisplaySource[]> =>
      ipcRenderer.invoke("capture:sources"),
    armSource: (sourceId: string): Promise<void> =>
      ipcRenderer.invoke("capture:arm-source", sourceId),
    askAccess: (kind: MediaAccessKind): Promise<MediaAccessStatus> =>
      ipcRenderer.invoke("capture:ask-access", kind),
    accessStatus: (kind: MediaAccessKind): Promise<MediaAccessStatus> =>
      ipcRenderer.invoke("capture:access-status", kind),
    clicksAvailable: (): Promise<boolean> =>
      ipcRenderer.invoke("capture:clicks-available"),
    clicksRequestAccess: (): Promise<boolean> =>
      ipcRenderer.invoke("capture:clicks-request-access"),
    clicksStart: (): Promise<boolean> =>
      ipcRenderer.invoke("capture:clicks-start"),
    clicksStop: (): Promise<void> => ipcRenderer.invoke("capture:clicks-stop"),
    onGlobalClick(handler: (click: GlobalClick) => void): () => void {
      const wrapped = (_e: unknown, click: GlobalClick) => handler(click);
      ipcRenderer.on("event:global-click", wrapped);
      return () => ipcRenderer.removeListener("event:global-click", wrapped);
    },
    onGlobalKey(handler: () => void): () => void {
      const wrapped = () => handler();
      ipcRenderer.on("event:global-key", wrapped);
      return () => ipcRenderer.removeListener("event:global-key", wrapped);
    },
    cursorStart: (): Promise<void> =>
      ipcRenderer.invoke("capture:cursor-start"),
    cursorStop: (): Promise<void> => ipcRenderer.invoke("capture:cursor-stop"),
    onCursorPos(handler: (pos: CursorPos) => void): () => void {
      const wrapped = (_e: unknown, pos: CursorPos) => handler(pos);
      ipcRenderer.on("event:cursor-pos", wrapped);
      return () => ipcRenderer.removeListener("event:cursor-pos", wrapped);
    },
  },
  recordings: {
    begin: (title: string, mimeType: string): Promise<RecordingMeta> =>
      ipcRenderer.invoke("rec:begin", title, mimeType),
    chunk: (id: string, chunk: ArrayBuffer): Promise<void> =>
      ipcRenderer.invoke("rec:chunk", id, chunk),
    finalize: (
      id: string,
      input: FinalizeRecordingInput,
    ): Promise<RecordingMeta> => ipcRenderer.invoke("rec:finalize", id, input),
    abort: (id: string): Promise<void> => ipcRenderer.invoke("rec:abort", id),
    list: (): Promise<RecordingMeta[]> => ipcRenderer.invoke("rec:list"),
    setTitle: (id: string, title: string): Promise<RecordingMeta> =>
      ipcRenderer.invoke("rec:set-title", id, title),
    setTags: (id: string, tags: string[]): Promise<RecordingMeta> =>
      ipcRenderer.invoke("rec:set-tags", id, tags),
    remove: (id: string): Promise<void> => ipcRenderer.invoke("rec:remove", id),
    /** Range-capable local playback URL served by the pearloom:// protocol. */
    playbackUrl: (id: string): string => `pearloom://media/recordings/${id}`,
  },
  profile: {
    get: (): Promise<Profile> => ipcRenderer.invoke("profile:get"),
    set: (profile: Profile): Promise<Profile> =>
      ipcRenderer.invoke("profile:set", profile),
  },
  spaces: {
    list: (): Promise<SpaceInfo[]> => ipcRenderer.invoke("space:list"),
    create: (name: string): Promise<SpaceInfo> =>
      ipcRenderer.invoke("space:create", name),
    join: (inviteCode: string): Promise<SpaceInfo> =>
      ipcRenderer.invoke("space:join", inviteCode),
    leave: (spaceId: string): Promise<void> =>
      ipcRenderer.invoke("space:leave", spaceId),
    invite: (spaceId: string): Promise<string> =>
      ipcRenderer.invoke("space:invite", spaceId),
    members: (spaceId: string): Promise<MemberInfo[]> =>
      ipcRenderer.invoke("space:members", spaceId),
    publish: (recordingId: string, spaceId: string): Promise<SharedRecording> =>
      ipcRenderer.invoke("space:publish", recordingId, spaceId),
    shared: (spaceId: string): Promise<SharedRecording[]> =>
      ipcRenderer.invoke("space:shared", spaceId),
    playbackUrl: (
      spaceId: string,
      driveKeyHex: string,
      drivePath: string,
    ): Promise<string> =>
      ipcRenderer.invoke("space:playback-url", spaceId, driveKeyHex, drivePath),
    comment: (
      spaceId: string,
      input: {
        recordingId: string;
        text: string;
        atMs: number | null;
        endMs: number | null;
      },
    ): Promise<CommentRecord> =>
      ipcRenderer.invoke("space:comment", spaceId, input),
    comments: (
      spaceId: string,
      recordingId: string,
    ): Promise<CommentRecord[]> =>
      ipcRenderer.invoke("space:comments", spaceId, recordingId),
    setCommentLike: (
      spaceId: string,
      recordingId: string,
      commentId: string,
      on: boolean,
    ): Promise<void> =>
      ipcRenderer.invoke(
        "space:comment-like",
        spaceId,
        recordingId,
        commentId,
        on,
      ),
    react: (
      spaceId: string,
      input: { recordingId: string; emoji: string; atMs: number },
    ): Promise<ReactionRecord> =>
      ipcRenderer.invoke("space:react", spaceId, input),
    reactions: (
      spaceId: string,
      recordingId: string,
    ): Promise<ReactionRecord[]> =>
      ipcRenderer.invoke("space:reactions", spaceId, recordingId),
  },
  /** Recording-time desktop UI: menu-bar timer + floating face bubble. */
  recui: {
    started: (cameraDeviceId: string | null): Promise<void> =>
      ipcRenderer.invoke("recui:started", cameraDeviceId),
    tick: (elapsedMs: number): Promise<void> =>
      ipcRenderer.invoke("recui:tick", elapsedMs),
    stopped: (): Promise<void> => ipcRenderer.invoke("recui:stopped"),
    setPaused: (paused: boolean): Promise<void> =>
      ipcRenderer.invoke("recui:set-paused", paused),
    requestStop: (): Promise<void> => ipcRenderer.invoke("recui:request-stop"),
    requestTogglePause: (): Promise<void> =>
      ipcRenderer.invoke("recui:request-toggle-pause"),
    onRequestStop(handler: () => void): () => void {
      const wrapped = () => handler();
      ipcRenderer.on("event:request-stop", wrapped);
      return () => ipcRenderer.removeListener("event:request-stop", wrapped);
    },
    onRequestTogglePause(handler: () => void): () => void {
      const wrapped = () => handler();
      ipcRenderer.on("event:request-toggle-pause", wrapped);
      return () =>
        ipcRenderer.removeListener("event:request-toggle-pause", wrapped);
    },
    onBubblePaused(handler: (paused: boolean) => void): () => void {
      const wrapped = (_e: unknown, paused: boolean) => handler(paused);
      ipcRenderer.on("event:bubble-paused", wrapped);
      return () => ipcRenderer.removeListener("event:bubble-paused", wrapped);
    },
    onBubbleTick(handler: (elapsedMs: number) => void): () => void {
      const wrapped = (_e: unknown, ms: number) => handler(ms);
      ipcRenderer.on("event:bubble-tick", wrapped);
      return () => ipcRenderer.removeListener("event:bubble-tick", wrapped);
    },
    bubbleMoveBy: (dx: number, dy: number): Promise<void> =>
      ipcRenderer.invoke("recui:bubble-move-by", dx, dy),
    /** Face-circle center of the bubble window, in screen points. */
    onBubbleMoved(handler: (pos: CursorPos) => void): () => void {
      const wrapped = (_e: unknown, pos: CursorPos) => handler(pos);
      ipcRenderer.on("event:bubble-moved", wrapped);
      return () => ipcRenderer.removeListener("event:bubble-moved", wrapped);
    },
  },
  /** Tray quick-record popover ↔ main window. */
  quickrec: {
    start: (opts: QuickRecStart): Promise<void> =>
      ipcRenderer.invoke("quickrec:start", opts),
    openApp: (): Promise<void> => ipcRenderer.invoke("quickrec:open-app"),
    close: (): Promise<void> => ipcRenderer.invoke("quickrec:close"),
    onRequestStart(handler: (opts: QuickRecStart) => void): () => void {
      const wrapped = (_e: unknown, opts: QuickRecStart) => handler(opts);
      ipcRenderer.on("event:request-start", wrapped);
      return () => ipcRenderer.removeListener("event:request-start", wrapped);
    },
    /** The persistent popover is being shown again — refetch sources. */
    onRefresh(handler: () => void): () => void {
      const wrapped = () => handler();
      ipcRenderer.on("event:quickrec-refresh", wrapped);
      return () =>
        ipcRenderer.removeListener("event:quickrec-refresh", wrapped);
    },
  },
  events: {
    on(
      channel: "spaces-changed" | "space-updated" | "peers-changed",
      handler: (payload?: unknown) => void,
    ): () => void {
      const wrapped = (_e: unknown, payload?: unknown) => handler(payload);
      ipcRenderer.on(`event:${channel}`, wrapped);
      return () => ipcRenderer.removeListener(`event:${channel}`, wrapped);
    },
  },
};

export type PearloomApi = typeof api;

contextBridge.exposeInMainWorld("pearloom", api);
