import {
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  screen,
  type BrowserWindow as BW,
} from "electron";
import { join } from "node:path";

/**
 * Recording-time desktop UI: while a recording runs, the main window hides
 * into the macOS menu bar (a tray item shows a live timer with Stop/Show),
 * and — when the camera is on — a small always-on-top circular "face bubble"
 * floats on the desktop.
 *
 * The bubble window uses setContentProtection(true), so screen capture does
 * NOT see it: the user sees their face while presenting, and the recording
 * gets the (composited) camera bubble exactly once.
 */

interface Deps {
  getWindow: () => BW | null;
}

let deps: Deps | null = null;
let tray: Tray | null = null;
let bubble: BrowserWindow | null = null;
let recording = false;
let paused = false;
let lastElapsedMs = 0;

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function requestStop() {
  deps?.getWindow()?.webContents.send("event:request-stop");
}

function requestTogglePause() {
  deps?.getWindow()?.webContents.send("event:request-toggle-pause");
}

function showApp() {
  const win = deps?.getWindow();
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function refreshTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate(
      recording
        ? [
            {
              label: paused ? "▶ Resume recording" : "⏸ Pause recording",
              click: requestTogglePause,
            },
            { label: "■ Stop recording", click: requestStop },
            { label: "Show Pearloom", click: showApp },
          ]
        : [
            { label: "Open Pearloom", click: showApp },
            { type: "separator" },
            { role: "quit", label: "Quit Pearloom" },
          ],
    ),
  );
}

export function isRecording(): boolean {
  return recording;
}

/** Create the persistent menu-bar item (call once after app is ready). */
export function initRecordingUi(d: Deps) {
  deps = d;
  tray = new Tray(nativeImage.createEmpty());
  tray.setTitle("🟣");
  tray.setToolTip("Pearloom");
  refreshTrayMenu();
}

export function recordingStarted(cameraDeviceId: string | null) {
  recording = true;
  paused = false;
  lastElapsedMs = 0;
  tray?.setTitle("🔴 0:00");
  refreshTrayMenu();
  deps?.getWindow()?.hide();
  if (cameraDeviceId) openBubble(cameraDeviceId);
}

export function recordingTick(elapsedMs: number) {
  if (!recording) return;
  lastElapsedMs = elapsedMs;
  if (!paused) tray?.setTitle(`🔴 ${formatElapsed(elapsedMs)}`);
  bubble?.webContents.send("event:bubble-tick", elapsedMs);
}

export function recordingPaused(isPaused: boolean) {
  if (!recording) return;
  paused = isPaused;
  tray?.setTitle(
    `${paused ? "⏸" : "🔴"} ${formatElapsed(lastElapsedMs)}`,
  );
  refreshTrayMenu();
  bubble?.webContents.send("event:bubble-paused", paused);
}

export function recordingStopped() {
  if (!recording) return;
  recording = false;
  paused = false;
  tray?.setTitle("🟣");
  refreshTrayMenu();
  closeBubble();
  showApp();
}

function openBubble(cameraDeviceId: string) {
  closeBubble();
  const { workArea } = screen.getPrimaryDisplay();
  bubble = new BrowserWindow({
    width: 200,
    height: 258,
    x: workArea.x + 24,
    y: workArea.y + workArea.height - 258 - 24,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  // Float above (almost) everything, follow the user across Spaces/fullscreen.
  bubble.setAlwaysOnTop(true, "screen-saver");
  bubble.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Exclude from screen capture: the composited camera already appears in the
  // recording — without this, the video would show the face twice.
  bubble.setContentProtection(true);
  bubble.loadFile(join(__dirname, "../renderer/index.html"), {
    hash: `bubble?camera=${encodeURIComponent(cameraDeviceId)}`,
  });
  bubble.once("ready-to-show", () => bubble?.showInactive());
  bubble.on("closed", () => {
    bubble = null;
  });
}

function closeBubble() {
  if (bubble && !bubble.isDestroyed()) bubble.close();
  bubble = null;
}

export function destroyRecordingUi() {
  closeBubble();
  tray?.destroy();
  tray = null;
}
