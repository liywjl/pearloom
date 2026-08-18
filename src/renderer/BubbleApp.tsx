import React, { useEffect, useRef, useState } from "react";
import { formatDuration } from "./lib/format";

/**
 * The floating desktop face bubble shown while recording (its window is
 * frameless, always-on-top and content-protected — invisible to the capture).
 * Renders the selected camera in a circle with a timer and a stop button.
 */
export function BubbleApp() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [paused, setPaused] = useState(false);
  const [cameraError, setCameraError] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.split("?")[1]);
    const deviceId = params.get("camera");
    let stream: MediaStream | null = null;
    let cancelled = false;
    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: deviceId
            ? { deviceId: { exact: deviceId }, width: 640, height: 480 }
            : true,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch {
        setCameraError(true);
      }
    };
    void start();
    const offTick = window.pearloom.recui.onBubbleTick(setElapsedMs);
    const offPaused = window.pearloom.recui.onBubblePaused(setPaused);
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      offTick();
      offPaused();
    };
  }, []);

  // Manual drag + two-finger scroll, both via bubbleMoveBy. A CSS drag
  // region (-webkit-app-region) would swallow mouse AND wheel events on
  // macOS, killing scroll-to-move — so the window moves itself instead.
  const onWheel = (e: React.WheelEvent) => {
    void window.pearloom.recui.bubbleMoveBy(e.deltaX, e.deltaY);
  };
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    const onMove = (ev: MouseEvent) => {
      void window.pearloom.recui.bubbleMoveBy(ev.movementX, ev.movementY);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div className="bubble-root" onWheel={onWheel} onMouseDown={onMouseDown}>
      <div className="bubble-face" title="Drag or scroll to move">
        {cameraError ? (
          <div className="bubble-fallback">🎥</div>
        ) : (
          <video ref={videoRef} autoPlay muted playsInline />
        )}
        <div className="bubble-ring" />
      </div>
      <div className="bubble-controls">
        <span className="bubble-timer">
          <span className={paused ? "pause-dot" : "rec-dot"} />
          {formatDuration(elapsedMs)}
        </span>
        <button
          className="bubble-stop"
          title={paused ? "Resume recording" : "Pause recording"}
          onClick={() => void window.pearloom.recui.requestTogglePause()}
        >
          {paused ? "▶" : "⏸"}
        </button>
        <button
          className="bubble-stop"
          title="Stop recording"
          onClick={() => void window.pearloom.recui.requestStop()}
        >
          ■
        </button>
      </div>
    </div>
  );
}
