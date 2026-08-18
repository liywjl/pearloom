import React, { useCallback, useEffect, useState } from "react";
import type {
  Profile,
  QuickRecStart,
  RecordingMeta,
  SharedRecording,
  SpaceInfo,
} from "../shared/types";
import { Sidebar } from "./components/Sidebar";
import { RecordView } from "./views/RecordView";
import { LibraryView } from "./views/LibraryView";
import { SpaceView } from "./views/SpaceView";
import { PlayerView, type PlayerTarget } from "./views/PlayerView";
import { useRecorder } from "./recorder/useRecorder";
import { formatDuration } from "./lib/format";

export type Route =
  | { view: "record" }
  | { view: "library" }
  | { view: "space"; spaceId: string }
  | { view: "player"; target: PlayerTarget; back: Route };

export function App() {
  // `--view library` (screenshot/smoke-test helper) deep-links the start view.
  const [route, setRoute] = useState<Route>(() =>
    window.location.hash === "#library"
      ? { view: "library" }
      : { view: "record" },
  );
  const [spaces, setSpaces] = useState<SpaceInfo[]>([]);
  const [recordings, setRecordings] = useState<RecordingMeta[]>([]);
  const [profile, setProfile] = useState<Profile>({ name: "" });

  // Recorder state lives HERE, above routing, so navigating between views
  // during a recording can never unmount an active MediaRecorder session.
  const recorder = useRecorder();

  // Keep the desktop recording UI (menu-bar timer + face bubble) in sync.
  const prevPhase = React.useRef(recorder.phase);
  useEffect(() => {
    const was = prevPhase.current;
    prevPhase.current = recorder.phase;
    if (recorder.phase === "recording" && was !== "recording") {
      void window.pearloom.recui.started(recorder.selectedCameraId);
    }
    if (recorder.phase === "paused" && was === "recording") {
      void window.pearloom.recui.setPaused(true);
    }
    if (recorder.phase === "recording" && was === "paused") {
      void window.pearloom.recui.setPaused(false);
    }
    if (
      recorder.phase === "idle" &&
      (was === "recording" || was === "paused" || was === "saving")
    ) {
      void window.pearloom.recui.stopped();
    }
  }, [recorder.phase, recorder.selectedCameraId]);

  const elapsedSec = Math.floor(recorder.elapsedMs / 1000);
  useEffect(() => {
    if (recorder.phase === "recording") {
      void window.pearloom.recui.tick(recorder.elapsedMs);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsedSec, recorder.phase]);

  // Stop / pause requests from the menu bar / face bubble.
  const stopRef = React.useRef<() => void>(() => {});
  stopRef.current = async () => {
    if (recorder.phase !== "recording" && recorder.phase !== "paused") return;
    const rec = await recorder.stop();
    if (rec) {
      await refreshRecordings();
      setRoute({
        view: "player",
        target: { kind: "local", recording: rec },
        back: { view: "library" },
      });
    }
  };
  const togglePauseRef = React.useRef<() => void>(() => {});
  togglePauseRef.current = () => {
    if (recorder.phase === "recording") recorder.pause();
    else if (recorder.phase === "paused") recorder.resume();
  };
  // Start requests from the tray quick-record popover.
  const startRef = React.useRef<(opts: QuickRecStart) => void>(() => {});
  startRef.current = (opts) => {
    if (recorder.phase !== "idle") return;
    void recorder.start({
      sourceId: opts.sourceId,
      cameraId: opts.camera ? recorder.selectedCameraId : null,
      micId: opts.mic ? recorder.selectedMicId : null,
    });
  };
  useEffect(() => {
    const offStop = window.pearloom.recui.onRequestStop(
      () => void stopRef.current(),
    );
    const offPause = window.pearloom.recui.onRequestTogglePause(() =>
      togglePauseRef.current(),
    );
    const offStart = window.pearloom.quickrec.onRequestStart((opts) =>
      startRef.current(opts),
    );
    return () => {
      offStop();
      offPause();
      offStart();
    };
  }, []);

  const refreshSpaces = useCallback(async () => {
    setSpaces(await window.pearloom.spaces.list());
  }, []);
  const refreshRecordings = useCallback(async () => {
    setRecordings(await window.pearloom.recordings.list());
  }, []);

  useEffect(() => {
    void refreshSpaces();
    void refreshRecordings();
    window.pearloom.profile.get().then(setProfile);
    const offSpaces = window.pearloom.events.on(
      "spaces-changed",
      () => void refreshSpaces(),
    );
    const offPeers = window.pearloom.events.on(
      "peers-changed",
      () => void refreshSpaces(),
    );
    return () => {
      offSpaces();
      offPeers();
    };
  }, [refreshSpaces, refreshRecordings]);

  const openLocalRecording = (rec: RecordingMeta, back: Route) =>
    setRoute({
      view: "player",
      target: { kind: "local", recording: rec },
      back,
    });
  const openSharedRecording = (rec: SharedRecording, back: Route) =>
    setRoute({
      view: "player",
      target: { kind: "shared", recording: rec },
      back,
    });

  return (
    <div className="app">
      <Sidebar
        route={route}
        spaces={spaces}
        profile={profile}
        onNavigate={setRoute}
        onProfileChange={async (name) =>
          setProfile(await window.pearloom.profile.set({ name }))
        }
        onSpacesChanged={refreshSpaces}
      />
      <main className="content">
        {route.view === "record" && (
          <RecordView
            recorder={recorder}
            onSaved={async (rec) => {
              await refreshRecordings();
              openLocalRecording(rec, { view: "library" });
            }}
          />
        )}
        {route.view === "library" && (
          <LibraryView
            recordings={recordings}
            spaces={spaces}
            onChanged={refreshRecordings}
            onOpen={(rec) => openLocalRecording(rec, { view: "library" })}
            onSpacesChanged={refreshSpaces}
          />
        )}
        {route.view === "space" && (
          <SpaceView
            key={route.spaceId}
            spaceId={route.spaceId}
            spaces={spaces}
            onOpen={(rec) => openSharedRecording(rec, route)}
            onLeft={async () => {
              await refreshSpaces();
              setRoute({ view: "library" });
            }}
          />
        )}
        {route.view === "player" && (
          <PlayerView
            key={
              route.target.kind === "local"
                ? route.target.recording.id
                : `${route.target.recording.spaceId}/${route.target.recording.id}`
            }
            target={route.target}
            onBack={() => setRoute(route.back)}
          />
        )}
      </main>

      {/* Recording continues across views — surface it wherever the user is. */}
      {(recorder.phase === "recording" ||
        recorder.phase === "paused" ||
        recorder.phase === "saving") &&
        route.view !== "record" && (
          <div className="floating-hud">
            <span
              className={recorder.phase === "paused" ? "pause-dot" : "rec-dot"}
            />
            <span className="floating-hud-time">
              {recorder.phase === "saving"
                ? "Saving…"
                : formatDuration(recorder.elapsedMs)}
            </span>
            <button
              className="btn small ghost"
              onClick={() => setRoute({ view: "record" })}
            >
              View
            </button>
            <button
              className="btn small ghost"
              disabled={recorder.phase === "saving"}
              onClick={() => togglePauseRef.current()}
            >
              {recorder.phase === "paused" ? "▶ Resume" : "⏸ Pause"}
            </button>
            <button
              className="btn small danger"
              disabled={recorder.phase === "saving"}
              onClick={async () => {
                const rec = await recorder.stop();
                if (rec) {
                  await refreshRecordings();
                  openLocalRecording(rec, { view: "library" });
                }
              }}
            >
              ■ Stop
            </button>
          </div>
        )}
    </div>
  );
}
