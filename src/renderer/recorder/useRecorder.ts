import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ActivityEvent,
  DisplaySource,
  RecordingMeta,
} from "../../shared/types";
import {
  startCompositor,
  type CompositorHandle,
  pickMimeType,
} from "./composite";

export interface DeviceChoice {
  deviceId: string;
  label: string;
}

export type RecorderPhase =
  | "idle"
  | "starting"
  | "recording"
  | "paused"
  | "saving";

export interface RecorderState {
  phase: RecorderPhase;
  error: string | null;
  elapsedMs: number;
  sources: DisplaySource[];
  cameras: DeviceChoice[];
  mics: DeviceChoice[];
  selectedSourceId: string | null;
  selectedCameraId: string | null; // null = camera off
  selectedMicId: string | null; // null = mic off
  previewStream: MediaStream | null;
  /** Burn click ripples into the recording (screens only). */
  showClicks: boolean;
  /** Global click capture is permitted (macOS Accessibility). */
  clicksAvailable: boolean;
}

export interface RecorderApi extends RecorderState {
  refreshDevices: () => Promise<void>;
  selectSource: (id: string) => void;
  selectCamera: (id: string | null) => void;
  selectMic: (id: string | null) => void;
  setShowClicks: (on: boolean) => Promise<void>;
  start: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => Promise<RecordingMeta | null>;
}

export function useRecorder(): RecorderApi {
  const [state, setState] = useState<RecorderState>({
    phase: "idle",
    error: null,
    elapsedMs: 0,
    sources: [],
    cameras: [],
    mics: [],
    selectedSourceId: null,
    selectedCameraId: null,
    selectedMicId: null,
    previewStream: null,
    showClicks: true,
    clicksAvailable: false,
  });

  const session = useRef<{
    compositor: CompositorHandle | null;
    recordingId: string | null;
    startedAt: number;
    pausedAt: number | null;
    streams: MediaStream[];
    pendingChunks: Promise<void>;
    timer: ReturnType<typeof setInterval> | null;
    offClicks: (() => void) | null;
    offKeys: (() => void) | null;
    offCursor: (() => void) | null;
    activity: ActivityEvent[];
  }>({
    compositor: null,
    recordingId: null,
    startedAt: 0,
    pausedAt: null,
    streams: [],
    pendingChunks: Promise.resolve(),
    timer: null,
    offClicks: null,
    offKeys: null,
    offCursor: null,
    activity: [],
  });

  // Coalesce keydowns into typing bursts; cap the track so a marathon
  // recording can't bloat the metadata.
  const MAX_ACTIVITY_EVENTS = 4000;
  const TYPING_GAP_MS = 1500;
  const pushActivity = (event: ActivityEvent) => {
    if (session.current.pausedAt !== null) return;
    const track = session.current.activity;
    if (event.kind === "typing") {
      const last = track[track.length - 1];
      if (
        last?.kind === "typing" &&
        event.atMs - (last.endMs ?? last.atMs) < TYPING_GAP_MS
      ) {
        last.endMs = event.atMs;
        return;
      }
    }
    if (track.length < MAX_ACTIVITY_EVENTS) track.push(event);
  };

  const patch = (p: Partial<RecorderState>) =>
    setState((s) => ({ ...s, ...p }));

  const refreshDevices = useCallback(async () => {
    try {
      // Ask for cam/mic consent up front so enumerateDevices returns labels.
      await window.pearloom.capture.askAccess("camera");
      await window.pearloom.capture.askAccess("microphone");
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices
        .filter((d) => d.kind === "videoinput")
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label || `Camera ${i + 1}`,
        }));
      const mics = devices
        .filter((d) => d.kind === "audioinput")
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label || `Microphone ${i + 1}`,
        }));
      const sources = await window.pearloom.capture.sources();
      setState((s) => ({
        ...s,
        cameras,
        mics,
        sources,
        selectedSourceId:
          s.selectedSourceId && sources.some((x) => x.id === s.selectedSourceId)
            ? s.selectedSourceId
            : (sources.find((x) => x.kind === "screen")?.id ??
              sources[0]?.id ??
              null),
        selectedCameraId:
          s.selectedCameraId &&
          cameras.some((c) => c.deviceId === s.selectedCameraId)
            ? s.selectedCameraId
            : (cameras[0]?.deviceId ?? null),
        selectedMicId:
          s.selectedMicId && mics.some((m) => m.deviceId === s.selectedMicId)
            ? s.selectedMicId
            : (mics[0]?.deviceId ?? null),
        error: null,
      }));
    } catch (err) {
      patch({ error: String(err) });
    }
  }, []);

  useEffect(() => {
    refreshDevices();
    window.pearloom.capture
      .clicksAvailable()
      .then((ok) => patch({ clicksAvailable: ok }));
  }, [refreshDevices]);

  const cleanupStreams = () => {
    for (const stream of session.current.streams) {
      for (const track of stream.getTracks()) track.stop();
    }
    session.current.streams = [];
    if (session.current.timer) clearInterval(session.current.timer);
    session.current.timer = null;
    session.current.offClicks?.();
    session.current.offClicks = null;
    session.current.offKeys?.();
    session.current.offKeys = null;
    session.current.offCursor?.();
    session.current.offCursor = null;
    void window.pearloom.capture.clicksStop();
    void window.pearloom.capture.cursorStop();
  };

  const start = useCallback(async () => {
    const { selectedSourceId, selectedCameraId, selectedMicId } =
      stateRef.current;
    if (!selectedSourceId) {
      patch({ error: "Pick a screen or window to record." });
      return;
    }
    patch({ phase: "starting", error: null, elapsedMs: 0 });
    try {
      await window.pearloom.capture.armSource(selectedSourceId);
      const screen = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: false,
      });
      session.current.streams.push(screen);

      let camera: MediaStream | null = null;
      if (selectedCameraId) {
        camera = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: { exact: selectedCameraId },
            width: 1280,
            height: 720,
          },
        });
        session.current.streams.push(camera);
      }
      let mic: MediaStream | null = null;
      if (selectedMicId) {
        mic = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: selectedMicId } },
        });
        session.current.streams.push(mic);
      }

      const title = `Recording ${new Date().toLocaleString()}`;
      const meta = await window.pearloom.recordings.begin(
        title,
        pickMimeType(),
      );
      session.current.recordingId = meta.id;
      session.current.startedAt = Date.now();

      session.current.compositor = startCompositor({
        screen,
        camera,
        mic,
        onChunk: (chunk) => {
          const id = session.current.recordingId;
          if (!id) return;
          session.current.pendingChunks = session.current.pendingChunks.then(
            () => window.pearloom.recordings.chunk(id, chunk).catch(() => {}),
          );
        },
      });

      // Stop if the user ends screen sharing from outside our UI.
      screen.getVideoTracks()[0]?.addEventListener("ended", () => {
        void stopRef.current?.();
      });

      // Cursor dot + click rings + activity timeline. Screen points map into
      // frame fractions via the recorded display's bounds. (Screens only —
      // window bounds aren't exposed for window sources.)
      const source = stateRef.current.sources.find(
        (s) => s.id === selectedSourceId,
      );
      const bounds = source?.displayBounds ?? null;
      session.current.activity = [];
      const elapsed = () => Date.now() - session.current.startedAt;

      if (stateRef.current.showClicks && bounds) {
        const toFrame = (p: { x: number; y: number }) => ({
          fx: (p.x - bounds.x) / bounds.width,
          fy: (p.y - bounds.y) / bounds.height,
        });

        // The red cursor dot needs no permission — always on for screens.
        await window.pearloom.capture.cursorStart();
        session.current.offCursor = window.pearloom.capture.onCursorPos(
          (pos) => {
            session.current.compositor?.setCursor(toFrame(pos));
          },
        );

        // Click rings + click/typing activity need the global hook.
        const started = await window.pearloom.capture.clicksStart();
        if (started) {
          session.current.offClicks = window.pearloom.capture.onGlobalClick(
            (click) => {
              const { fx, fy } = toFrame(click);
              session.current.compositor?.addClick(fx, fy);
              if (fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1) {
                pushActivity({ kind: "click", atMs: elapsed() });
              }
            },
          );
          session.current.offKeys = window.pearloom.capture.onGlobalKey(() => {
            pushActivity({ kind: "typing", atMs: elapsed() });
          });
        }
      }

      session.current.timer = setInterval(() => {
        patch({ elapsedMs: Date.now() - session.current.startedAt });
      }, 250);

      patch({
        phase: "recording",
        previewStream: session.current.compositor.previewStream,
      });
    } catch (err) {
      cleanupStreams();
      if (session.current.recordingId) {
        await window.pearloom.recordings
          .abort(session.current.recordingId)
          .catch(() => {});
        session.current.recordingId = null;
      }
      session.current.compositor?.stop();
      session.current.compositor = null;
      patch({
        phase: "idle",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  // Pausing shifts startedAt forward on resume, so "Date.now() - startedAt"
  // stays the recorded duration (paused stretches excluded) everywhere.
  const pause = useCallback(() => {
    if (stateRef.current.phase !== "recording") return;
    session.current.compositor?.pause();
    session.current.pausedAt = Date.now();
    if (session.current.timer) clearInterval(session.current.timer);
    session.current.timer = null;
    patch({ phase: "paused" });
  }, []);

  const resume = useCallback(() => {
    if (stateRef.current.phase !== "paused") return;
    const { pausedAt } = session.current;
    if (pausedAt !== null) session.current.startedAt += Date.now() - pausedAt;
    session.current.pausedAt = null;
    session.current.compositor?.resume();
    session.current.timer = setInterval(() => {
      patch({ elapsedMs: Date.now() - session.current.startedAt });
    }, 250);
    patch({ phase: "recording" });
  }, []);

  const stop = useCallback(async (): Promise<RecordingMeta | null> => {
    const { compositor, recordingId, startedAt, pausedAt } = session.current;
    const phase = stateRef.current.phase;
    if (
      !compositor ||
      !recordingId ||
      (phase !== "recording" && phase !== "paused")
    )
      return null;
    patch({ phase: "saving" });

    const thumbnail = compositor.thumbnail();
    const durationMs = (pausedAt ?? Date.now()) - startedAt;
    session.current.pausedAt = null;

    compositor.stop();
    // Wait for the final chunk (bounded, in case onstop never fires).
    await Promise.race([
      compositor.stopped,
      new Promise<void>((resolve) => setTimeout(resolve, 5000)),
    ]);
    // Flush any chunks still in flight to the main process.
    await session.current.pendingChunks;

    cleanupStreams();
    session.current.compositor = null;
    session.current.recordingId = null;

    const meta = await window.pearloom.recordings.finalize(recordingId, {
      durationMs,
      thumbnailDataUrl: thumbnail,
      activity: session.current.activity,
    });
    patch({ phase: "idle", previewStream: null, elapsedMs: 0 });
    return meta;
  }, []);

  // Refs so async callbacks always see the current state/stop.
  const stateRef = useRef(state);
  stateRef.current = state;
  const stopRef = useRef<typeof stop | null>(null);
  stopRef.current = stop;

  const setShowClicks = useCallback(async (on: boolean) => {
    if (on) {
      // May pop the macOS Accessibility consent dialog on first use.
      const ok = await window.pearloom.capture.clicksRequestAccess();
      patch({ showClicks: true, clicksAvailable: ok });
    } else {
      patch({ showClicks: false });
    }
  }, []);

  return {
    ...state,
    refreshDevices,
    selectSource: (id) => patch({ selectedSourceId: id }),
    selectCamera: (id) => patch({ selectedCameraId: id }),
    selectMic: (id) => patch({ selectedMicId: id }),
    setShowClicks,
    start,
    pause,
    resume,
    stop,
  };
}
