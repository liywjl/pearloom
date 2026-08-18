import React, { useEffect, useState } from "react";
import type { DisplaySource } from "../shared/types";

/**
 * The tray quick-record popover: pick a screen, toggle camera/mic, record —
 * without opening the full app window. Starting is forwarded to the main
 * window's renderer, which owns the recorder.
 */
export function QuickRecApp() {
  const [screens, setScreens] = useState<DisplaySource[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [camera, setCamera] = useState(true);
  const [mic, setMic] = useState(true);

  useEffect(() => {
    const load = () =>
      void window.pearloom.capture.sources().then((sources) => {
        const found = sources.filter((s) => s.kind === "screen");
        setScreens(found);
        setSelectedId((prev) =>
          prev && found.some((s) => s.id === prev)
            ? prev
            : (found[0]?.id ?? null),
        );
      });
    load();
    // The window stays alive between opens — refresh thumbnails on each show.
    const offRefresh = window.pearloom.quickrec.onRefresh(load);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void window.pearloom.quickrec.close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      offRefresh();
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className="quickrec-root">
      <header className="quickrec-header">
        <span className="quickrec-title">New recording</span>
        <button
          className="quickrec-link"
          onClick={() => void window.pearloom.quickrec.openApp()}
        >
          Open app ↗
        </button>
      </header>

      <div className="quickrec-screens">
        {screens.map((s) => (
          <button
            key={s.id}
            className={`quickrec-screen${selectedId === s.id ? " selected" : ""}`}
            onClick={() => setSelectedId(s.id)}
            title={s.name}
          >
            <img src={s.thumbnailDataUrl} alt="" />
            <span>{s.name}</span>
          </button>
        ))}
        {screens.length === 0 && (
          <p className="muted">
            No screens available — grant Screen Recording permission in System
            Settings → Privacy &amp; Security.
          </p>
        )}
      </div>

      <label className="checkbox quickrec-toggle">
        <input
          type="checkbox"
          checked={camera}
          onChange={(e) => setCamera(e.target.checked)}
        />
        Camera bubble
      </label>
      <label className="checkbox quickrec-toggle">
        <input
          type="checkbox"
          checked={mic}
          onChange={(e) => setMic(e.target.checked)}
        />
        Microphone
      </label>

      <button
        className="btn primary big quickrec-start"
        disabled={!selectedId}
        onClick={() =>
          void window.pearloom.quickrec.start({
            sourceId: selectedId!,
            camera,
            mic,
          })
        }
      >
        ● Start recording
      </button>
    </div>
  );
}
