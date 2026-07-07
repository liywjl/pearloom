/**
 * Composites the screen stream with an optional circular camera bubble
 * (Loom-style, bottom-left) onto a canvas, and records canvas + mic audio
 * with MediaRecorder. Chunks are handed to the caller as they arrive.
 */

export interface CompositorOptions {
  screen: MediaStream;
  camera: MediaStream | null;
  mic: MediaStream | null;
  onChunk: (chunk: ArrayBuffer) => void;
}

export interface CompositorHandle {
  mimeType: string;
  /** Live preview stream (what is being recorded). */
  previewStream: MediaStream;
  stop: () => void;
  /** Resolves after the recorder has emitted its final chunk. */
  stopped: Promise<void>;
  /** Grab a small JPEG thumbnail of the current frame. */
  thumbnail: () => string | null;
  /** Burn a click ring at (x, y) in 0–1 fractions of the frame. */
  addClick: (fx: number, fy: number) => void;
  /** Move the burned-in red cursor dot ((x, y) in 0–1 fractions; null hides). */
  setCursor: (pos: { fx: number; fy: number } | null) => void;
}

const BUBBLE_RATIO = 0.22; // bubble diameter as a fraction of canvas height
const BUBBLE_MARGIN = 24;
const FRAME_MS = 1000 / 30;
const RIPPLE_MS = 550;

export function pickMimeType(): string {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return (
    candidates.find((c) => MediaRecorder.isTypeSupported(c)) ?? "video/webm"
  );
}

export function startCompositor(opts: CompositorOptions): CompositorHandle {
  const screenVideo = document.createElement("video");
  screenVideo.srcObject = opts.screen;
  screenVideo.muted = true;
  void screenVideo.play();

  let cameraVideo: HTMLVideoElement | null = null;
  if (opts.camera) {
    cameraVideo = document.createElement("video");
    cameraVideo.srcObject = opts.camera;
    cameraVideo.muted = true;
    void cameraVideo.play();
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { alpha: false })!;
  canvas.width = 1280;
  canvas.height = 720;

  let stopped = false;
  const ripples: { fx: number; fy: number; t0: number }[] = [];
  let cursor: { fx: number; fy: number } | null = null;

  const draw = () => {
    if (stopped) return;
    const vw = screenVideo.videoWidth;
    const vh = screenVideo.videoHeight;
    if (vw && vh && (canvas.width !== vw || canvas.height !== vh)) {
      // Match the source resolution once known (cap at 4K to bound CPU).
      const scale = Math.min(1, 3840 / vw, 2160 / vh);
      canvas.width = Math.round(vw * scale);
      canvas.height = Math.round(vh * scale);
    }
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (vw && vh) ctx.drawImage(screenVideo, 0, 0, canvas.width, canvas.height);

    // Click rings: expanding, fading red circles at the click point.
    const now = performance.now();
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i]!;
      const p = (now - r.t0) / RIPPLE_MS;
      if (p >= 1) {
        ripples.splice(i, 1);
        continue;
      }
      const cx = r.fx * canvas.width;
      const cy = r.fy * canvas.height;
      const maxR = Math.max(30, canvas.height * 0.05);
      ctx.beginPath();
      ctx.arc(cx, cy, 7 + p * maxR, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 59, 48, ${0.95 * (1 - p)})`;
      ctx.lineWidth = Math.max(3, canvas.height * 0.006);
      ctx.stroke();
    }

    // Persistent little red cursor dot (macOS captures exclude the pointer).
    if (cursor) {
      const cx = cursor.fx * canvas.width;
      const cy = cursor.fy * canvas.height;
      const r = Math.max(5, canvas.height * 0.008);
      ctx.beginPath();
      ctx.arc(cx, cy, r + 1.5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 59, 48, 0.95)";
      ctx.fill();
    }

    if (cameraVideo && cameraVideo.videoWidth) {
      const d = Math.round(canvas.height * BUBBLE_RATIO);
      const x = BUBBLE_MARGIN;
      const y = canvas.height - d - BUBBLE_MARGIN;
      const cx = x + d / 2;
      const cy = y + d / 2;

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, d / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      // cover-fit the camera into the circle
      const cw = cameraVideo.videoWidth;
      const ch = cameraVideo.videoHeight;
      const s = Math.max(d / cw, d / ch);
      ctx.drawImage(
        cameraVideo,
        cx - (cw * s) / 2,
        cy - (ch * s) / 2,
        cw * s,
        ch * s,
      );
      ctx.restore();

      ctx.beginPath();
      ctx.arc(cx, cy, d / 2 + 2, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 4;
      ctx.stroke();
    }
  };
  // Drive drawing with a timer, NOT requestAnimationFrame: rAF freezes when
  // the window is backgrounded/occluded (i.e. whenever the user records some
  // other app), which froze recordings. Timers keep firing because the window
  // is created with backgroundThrottling: false.
  const timer = setInterval(draw, FRAME_MS);

  const canvasStream = canvas.captureStream(30);
  const tracks: MediaStreamTrack[] = [...canvasStream.getVideoTracks()];
  if (opts.mic) tracks.push(...opts.mic.getAudioTracks());
  const recordedStream = new MediaStream(tracks);

  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(recordedStream, {
    mimeType,
    videoBitsPerSecond: 6_000_000,
  });

  // Serialize chunk delivery so ordering is preserved even though
  // Blob.arrayBuffer() resolves out of band.
  let chunkQueue: Promise<void> = Promise.resolve();
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) {
      const blob = e.data;
      chunkQueue = chunkQueue.then(async () => {
        opts.onChunk(await blob.arrayBuffer());
      });
    }
  };
  let resolveStopped!: () => void;
  const stoppedPromise = new Promise<void>(
    (resolve) => (resolveStopped = resolve),
  );
  recorder.onstop = () => {
    stopped = true;
    clearInterval(timer);
    // Final dataavailable fires before onstop; wait for its buffer to flush.
    void chunkQueue.then(resolveStopped);
  };
  recorder.start(1000);

  return {
    mimeType,
    stopped: stoppedPromise,
    previewStream: recordedStream,
    addClick: (fx, fy) => {
      if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return;
      ripples.push({ fx, fy, t0: performance.now() });
    },
    setCursor: (pos) => {
      cursor =
        pos && pos.fx >= 0 && pos.fx <= 1 && pos.fy >= 0 && pos.fy <= 1
          ? pos
          : null;
    },
    thumbnail: () => {
      try {
        const t = document.createElement("canvas");
        const scale = 320 / canvas.width;
        t.width = 320;
        t.height = Math.round(canvas.height * scale);
        t.getContext("2d")!.drawImage(canvas, 0, 0, t.width, t.height);
        return t.toDataURL("image/jpeg", 0.7);
      } catch {
        return null;
      }
    },
    stop: () => {
      if (recorder.state !== "inactive") recorder.stop();
    },
  };
}
