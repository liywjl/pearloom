import React, { useCallback, useEffect, useState } from "react";
import type {
  Profile,
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
  const [route, setRoute] = useState<Route>({ view: "record" });
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
      void window.loom.recui.started(recorder.selectedCameraId);
    }
    if (
      recorder.phase === "idle" &&
      (was === "recording" || was === "saving")
    ) {
      void window.loom.recui.stopped();
    }
  }, [recorder.phase, recorder.selectedCameraId]);

  const elapsedSec = Math.floor(recorder.elapsedMs / 1000);
  useEffect(() => {
    if (recorder.phase === "recording") {
      void window.loom.recui.tick(recorder.elapsedMs);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsedSec, recorder.phase]);

  // Stop requests from the menu bar / face bubble.
  const stopRef = React.useRef<() => void>(() => {});
  stopRef.current = async () => {
    if (recorder.phase !== "recording") return;
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
  useEffect(
    () => window.loom.recui.onRequestStop(() => void stopRef.current()),
    [],
  );

  const refreshSpaces = useCallback(async () => {
    setSpaces(await window.loom.spaces.list());
  }, []);
  const refreshRecordings = useCallback(async () => {
    setRecordings(await window.loom.recordings.list());
  }, []);

  useEffect(() => {
    void refreshSpaces();
    void refreshRecordings();
    window.loom.profile.get().then(setProfile);
    const offSpaces = window.loom.events.on(
      "spaces-changed",
      () => void refreshSpaces(),
    );
    const offPeers = window.loom.events.on(
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
          setProfile(await window.loom.profile.set({ name }))
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
      {(recorder.phase === "recording" || recorder.phase === "saving") &&
        route.view !== "record" && (
          <div className="floating-hud">
            <span className="rec-dot" />
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
              className="btn small danger"
              disabled={recorder.phase !== "recording"}
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
