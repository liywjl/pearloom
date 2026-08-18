import { ipcMain, type BrowserWindow } from "electron";
import type { RecordingStore } from "./recordings";
import type { P2PEngine } from "./p2p/engine";
import {
  armDisplaySource,
  askMediaAccess,
  clickCaptureAvailable,
  listDisplaySources,
  mediaAccessStatus,
  requestClickCaptureAccess,
  startClickCapture,
  startCursorTracking,
  stopClickCapture,
  stopCursorTracking,
} from "./capture";
import {
  recordingPaused,
  recordingStarted,
  recordingStopped,
  recordingTick,
} from "./recui";
import type {
  FinalizeRecordingInput,
  MediaAccessKind,
  Profile,
} from "../shared/types";

interface Deps {
  recordings: RecordingStore;
  p2p: P2PEngine;
  getWindow: () => BrowserWindow | null;
}

export function registerIpcHandlers({ recordings, p2p, getWindow }: Deps) {
  // capture
  ipcMain.handle("capture:sources", () => listDisplaySources());
  ipcMain.handle("capture:arm-source", (_e, sourceId: string) =>
    armDisplaySource(sourceId),
  );
  ipcMain.handle("capture:ask-access", (_e, kind: MediaAccessKind) =>
    askMediaAccess(kind),
  );
  ipcMain.handle("capture:access-status", (_e, kind: MediaAccessKind) =>
    mediaAccessStatus(kind),
  );

  // global click/typing capture (recording overlay + activity timeline)
  ipcMain.handle("capture:clicks-available", () => clickCaptureAvailable());
  ipcMain.handle("capture:clicks-request-access", () =>
    requestClickCaptureAccess(),
  );
  ipcMain.handle("capture:clicks-start", () =>
    startClickCapture(
      (click) => getWindow()?.webContents.send("event:global-click", click),
      () => getWindow()?.webContents.send("event:global-key"),
    ),
  );
  ipcMain.handle("capture:clicks-stop", () => stopClickCapture());

  // cursor tracking (persistent red dot; no permission needed)
  ipcMain.handle("capture:cursor-start", () =>
    startCursorTracking((pos) =>
      getWindow()?.webContents.send("event:cursor-pos", pos),
    ),
  );
  ipcMain.handle("capture:cursor-stop", () => stopCursorTracking());

  // recording-time desktop UI (menu-bar timer + face bubble)
  ipcMain.handle("recui:started", (_e, cameraDeviceId: string | null) =>
    recordingStarted(cameraDeviceId),
  );
  ipcMain.handle("recui:tick", (_e, elapsedMs: number) =>
    recordingTick(elapsedMs),
  );
  ipcMain.handle("recui:stopped", () => recordingStopped());
  ipcMain.handle("recui:set-paused", (_e, paused: boolean) =>
    recordingPaused(paused),
  );
  // Sent from the bubble window; routed to the main window's recorder.
  ipcMain.handle("recui:request-stop", () =>
    getWindow()?.webContents.send("event:request-stop"),
  );
  ipcMain.handle("recui:request-toggle-pause", () =>
    getWindow()?.webContents.send("event:request-toggle-pause"),
  );

  // local recordings
  ipcMain.handle("rec:begin", (_e, title: string, mimeType: string) =>
    recordings.begin(title, mimeType),
  );
  ipcMain.handle("rec:chunk", (_e, id: string, chunk: ArrayBuffer) =>
    recordings.appendChunk(id, new Uint8Array(chunk)),
  );
  ipcMain.handle(
    "rec:finalize",
    (_e, id: string, input: FinalizeRecordingInput) =>
      recordings.finalize(id, input),
  );
  ipcMain.handle("rec:abort", (_e, id: string) => recordings.abort(id));
  ipcMain.handle("rec:list", () => recordings.list());
  ipcMain.handle("rec:set-title", (_e, id: string, title: string) =>
    recordings.setTitle(id, title),
  );
  ipcMain.handle("rec:set-tags", (_e, id: string, tags: string[]) =>
    recordings.setTags(id, tags),
  );
  ipcMain.handle("rec:remove", (_e, id: string) => recordings.remove(id));

  // profile
  ipcMain.handle("profile:get", () => p2p.getProfile());
  ipcMain.handle("profile:set", (_e, profile: Profile) =>
    p2p.setProfile(profile),
  );

  // spaces + sharing + comments
  ipcMain.handle("space:list", () => p2p.listSpaces());
  ipcMain.handle("space:create", (_e, name: string) => p2p.createSpace(name));
  ipcMain.handle("space:join", (_e, inviteCode: string) =>
    p2p.joinSpace(inviteCode),
  );
  ipcMain.handle("space:leave", (_e, spaceId: string) =>
    p2p.leaveSpace(spaceId),
  );
  ipcMain.handle("space:invite", (_e, spaceId: string) =>
    p2p.createInvite(spaceId),
  );
  ipcMain.handle("space:members", (_e, spaceId: string) =>
    p2p.listMembers(spaceId),
  );
  ipcMain.handle("space:publish", (_e, recordingId: string, spaceId: string) =>
    p2p.publishRecording(recordingId, spaceId),
  );
  ipcMain.handle("space:shared", (_e, spaceId: string) =>
    p2p.listShared(spaceId),
  );
  ipcMain.handle(
    "space:playback-url",
    (_e, spaceId: string, driveKeyHex: string, drivePath: string) =>
      p2p.playbackUrl(spaceId, driveKeyHex, drivePath),
  );
  ipcMain.handle(
    "space:comment",
    (
      _e,
      spaceId: string,
      input: {
        recordingId: string;
        text: string;
        atMs: number | null;
        endMs: number | null;
      },
    ) => p2p.addComment(spaceId, input),
  );
  ipcMain.handle("space:comments", (_e, spaceId: string, recordingId: string) =>
    p2p.listComments(spaceId, recordingId),
  );
  ipcMain.handle(
    "space:comment-like",
    (
      _e,
      spaceId: string,
      recordingId: string,
      commentId: string,
      on: boolean,
    ) => p2p.setCommentLike(spaceId, recordingId, commentId, on),
  );
  ipcMain.handle(
    "space:react",
    (
      _e,
      spaceId: string,
      input: { recordingId: string; emoji: string; atMs: number },
    ) => p2p.addReaction(spaceId, input),
  );
  ipcMain.handle(
    "space:reactions",
    (_e, spaceId: string, recordingId: string) =>
      p2p.listReactions(spaceId, recordingId),
  );

  // push events to the renderer
  const forward = (channel: string) => (payload?: unknown) => {
    getWindow()?.webContents.send(channel, payload);
  };
  p2p.on("spaces-changed", forward("event:spaces-changed"));
  p2p.on("space-updated", forward("event:space-updated"));
  p2p.on("peers-changed", forward("event:peers-changed"));
}
