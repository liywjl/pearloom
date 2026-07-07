/** A capturable screen or window, as reported by Electron's desktopCapturer. */
export interface DisplaySource {
  id: string;
  name: string;
  kind: "screen" | "window";
  thumbnailDataUrl: string;
  appIconDataUrl: string | null;
  /**
   * Global bounds (points) of the matching display for kind === 'screen'.
   * Used to map global click coordinates into the recorded frame; null for
   * window sources (their bounds aren't exposed by desktopCapturer).
   */
  displayBounds: { x: number; y: number; width: number; height: number } | null;
}

/** A global mouse click observed while recording (screen points). */
export interface GlobalClick {
  x: number;
  y: number;
}

/** The live cursor position while recording (screen points). */
export interface CursorPos {
  x: number;
  y: number;
}

/**
 * One entry in a recording's activity track: a click, or a burst of typing.
 * Only timing is captured — never which keys were pressed.
 */
export interface ActivityEvent {
  kind: "click" | "typing";
  /** Offset from the start of the recording (ms). */
  atMs: number;
  /** Bursts (typing) extend to here; clicks are instants. */
  endMs?: number;
}

export type MediaAccessKind = "camera" | "microphone" | "screen";
export type MediaAccessStatus =
  "granted" | "denied" | "restricted" | "not-determined" | "unknown";

/** A recording stored locally on this machine. */
export interface RecordingMeta {
  id: string;
  title: string;
  createdAt: number;
  durationMs: number;
  sizeBytes: number;
  mimeType: string;
  thumbnailDataUrl: string | null;
  /** Space ids this recording has been published to. */
  sharedTo: string[];
  /** Clicks + typing bursts captured while recording (timeline track). */
  activity: ActivityEvent[];
  /** Free-form labels for search/filter in the library. */
  tags: string[];
}

/** A share space: a multi-writer Autobase room recordings are published into. */
export interface SpaceInfo {
  id: string;
  name: string;
  writable: boolean;
  isCreator: boolean;
  connectedPeers: number;
}

/** A recording published into a space (may live on a remote peer's drive). */
export interface SharedRecording {
  id: string;
  spaceId: string;
  title: string;
  createdAt: number;
  durationMs: number;
  sizeBytes: number;
  mimeType: string;
  ownerName: string;
  ownerKey: string;
  driveKey: string;
  drivePath: string;
  /** True when this entry was published from this device. */
  mine: boolean;
  /** True when the blob is fully available locally (own file or finished download). */
  available: boolean;
  /** Activity track captured at record time (travels with the publication). */
  activity: ActivityEvent[];
  /** Labels the owner attached when publishing. */
  tags: string[];
}

export interface CommentRecord {
  id: string;
  spaceId: string;
  recordingId: string;
  author: string;
  authorKey: string;
  text: string;
  /** Video timestamp (ms) the comment is anchored to, or null for general feedback. */
  atMs: number | null;
  /** End of the anchored section (ms), when the comment covers a range. */
  endMs: number | null;
  createdAt: number;
  /** Filled in by listComments: like tallies for this comment. */
  likeCount: number;
  likedByMe: boolean;
}

/** An emoji reaction anchored to a moment in a recording. */
export interface ReactionRecord {
  id: string;
  spaceId: string;
  recordingId: string;
  emoji: string;
  atMs: number;
  author: string;
  authorKey: string;
  createdAt: number;
}

export interface DownloadProgress {
  spaceId: string;
  recordingId: string;
  downloadedBytes: number;
  totalBytes: number;
  done: boolean;
  error: string | null;
}

export interface Profile {
  name: string;
}

/** A member of a space, from its converged member registry. */
export interface MemberInfo {
  key: string;
  name: string;
  addedAt: number;
}

/** Payload for finalizing a recording after MediaRecorder stops. */
export interface FinalizeRecordingInput {
  durationMs: number;
  thumbnailDataUrl: string | null;
  activity: ActivityEvent[];
}
