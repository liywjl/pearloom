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
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      offTick();
    };
  }, []);

  return (
    <div className="bubble-root">
      <div className="bubble-face" title="Drag to move">
        {cameraError ? (
          <div className="bubble-fallback">🎥</div>
        ) : (
          <video ref={videoRef} autoPlay muted playsInline />
        )}
        <div className="bubble-ring" />
      </div>
      <div className="bubble-controls">
        <span className="bubble-timer">
          <span className="rec-dot" />
          {formatDuration(elapsedMs)}
        </span>
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
