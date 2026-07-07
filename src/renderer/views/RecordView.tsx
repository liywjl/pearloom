import React, { useEffect, useRef, useState } from "react";
import type { RecordingMeta } from "../../shared/types";
import type { RecorderApi } from "../recorder/useRecorder";
import { formatDuration } from "../lib/format";

interface Props {
  /** Owned by App so recordings survive navigation between views. */
  recorder: RecorderApi;
  onSaved: (rec: RecordingMeta) => void;
}

export function RecordView({ recorder: rec, onSaved }: Props) {
  const [sourceKind, setSourceKind] = useState<"screen" | "window">("screen");
  const previewRef = useRef<HTMLVideoElement>(null);
  const cameraPreviewRef = useRef<HTMLVideoElement>(null);
  const [cameraPreview, setCameraPreview] = useState<MediaStream | null>(null);

  // Live camera self-view while configuring (not while recording).
  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    const startPreview = async () => {
      if (rec.phase !== "idle" || !rec.selectedCameraId) {
        setCameraPreview(null);
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: { exact: rec.selectedCameraId },
            width: 640,
            height: 360,
          },
        });
        if (cancelled) stream.getTracks().forEach((t) => t.stop());
        else setCameraPreview(stream);
      } catch {
        setCameraPreview(null);
      }
    };
    void startPreview();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [rec.selectedCameraId, rec.phase]);

  useEffect(() => {
    if (cameraPreviewRef.current)
      cameraPreviewRef.current.srcObject = cameraPreview;
  }, [cameraPreview]);

  useEffect(() => {
    if (previewRef.current && rec.previewStream)
      previewRef.current.srcObject = rec.previewStream;
  }, [rec.previewStream]);

  if (
    rec.phase === "recording" ||
    rec.phase === "saving" ||
    rec.phase === "starting"
  ) {
    return (
      <div className="record-live">
        <div className="record-hud">
          <span className="rec-dot" />
          {rec.phase === "recording"
            ? formatDuration(rec.elapsedMs)
            : rec.phase === "saving"
              ? "Saving…"
              : "Starting…"}
          <button
            className="btn danger"
            disabled={rec.phase !== "recording"}
            onClick={async () => {
              const meta = await rec.stop();
              if (meta) onSaved(meta);
            }}
          >
            ■ Stop recording
          </button>
        </div>
        <video ref={previewRef} className="record-preview" autoPlay muted />
      </div>
    );
  }

  const sources = rec.sources.filter((s) => s.kind === sourceKind);

  return (
    <div className="record-setup">
      <header className="view-header">
        <h1>New recording</h1>
        <p className="muted">
          Pick what to capture. Recordings are saved locally — share them only
          when you choose to.
        </p>
      </header>

      {rec.error && <div className="error-banner">{rec.error}</div>}

      <section className="picker-section">
        <div className="picker-title-row">
          <h2>Screen</h2>
          <div className="segmented">
            <button
              className={sourceKind === "screen" ? "on" : ""}
              onClick={() => setSourceKind("screen")}
            >
              Entire screen
            </button>
            <button
              className={sourceKind === "window" ? "on" : ""}
              onClick={() => setSourceKind("window")}
            >
              Window
            </button>
          </div>
          <button
            className="btn ghost small"
            onClick={() => void rec.refreshDevices()}
          >
            ↻ Refresh
          </button>
        </div>
        <div className="source-grid">
          {sources.map((s) => (
            <button
              key={s.id}
              className={`source-card${rec.selectedSourceId === s.id ? " selected" : ""}`}
              onClick={() => rec.selectSource(s.id)}
              title={s.name}
            >
              <img src={s.thumbnailDataUrl} alt="" />
              <span className="source-name">
                {s.appIconDataUrl && (
                  <img className="source-icon" src={s.appIconDataUrl} alt="" />
                )}
                {s.name}
              </span>
            </button>
          ))}
          {sources.length === 0 && (
            <div className="muted">
              No {sourceKind === "screen" ? "screens" : "windows"} available. On
              macOS, grant Screen Recording permission in System Settings →
              Privacy &amp; Security, then hit Refresh.
            </div>
          )}
        </div>
      </section>

      <section className="picker-section device-row">
        <div className="device-picker">
          <h2>Camera</h2>
          <select
            value={rec.selectedCameraId ?? ""}
            onChange={(e) => rec.selectCamera(e.target.value || null)}
          >
            <option value="">Off — screen only</option>
            {rec.cameras.map((c) => (
              <option key={c.deviceId} value={c.deviceId}>
                {c.label}
              </option>
            ))}
          </select>
          {cameraPreview && (
            <video
              ref={cameraPreviewRef}
              className="camera-preview"
              autoPlay
              muted
            />
          )}
        </div>

        <div className="device-picker">
          <h2>Microphone</h2>
          <select
            value={rec.selectedMicId ?? ""}
            onChange={(e) => rec.selectMic(e.target.value || null)}
          >
            <option value="">Off — no audio</option>
            {rec.mics.map((m) => (
              <option key={m.deviceId} value={m.deviceId}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <div className="device-picker">
          <h2>Cursor &amp; activity</h2>
          <label className="checkbox clicks-toggle">
            <input
              type="checkbox"
              checked={rec.showClicks}
              onChange={(e) => void rec.setShowClicks(e.target.checked)}
            />
            Red cursor dot, click rings &amp; activity timeline
          </label>
          {rec.showClicks && !rec.clicksAvailable && (
            <p className="muted">
              The cursor dot always works. Click rings and the click/typing
              timeline additionally need the Accessibility permission (System
              Settings → Privacy &amp; Security → Accessibility). Only timing is
              captured — never what you type.
            </p>
          )}
          {rec.showClicks &&
            rec.clicksAvailable &&
            rec.sources.find((s) => s.id === rec.selectedSourceId)?.kind ===
              "window" && (
              <p className="muted">
                Cursor &amp; click overlays only apply when recording a full
                screen.
              </p>
            )}
        </div>
      </section>

      <div className="record-actions">
        <button
          className="btn primary big"
          disabled={!rec.selectedSourceId}
          onClick={() => void rec.start()}
        >
          ● Start recording
        </button>
        {rec.selectedCameraId && (
          <span className="muted">
            Your camera appears as a bubble in the corner, Loom-style.
          </span>
        )}
      </div>
    </div>
  );
}
