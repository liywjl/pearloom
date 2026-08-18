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
let quickRec: BrowserWindow | null = null;
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

export function showApp() {
  const win = deps?.getWindow();
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function trayMenu(): Menu {
  return Menu.buildFromTemplate(
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
          { label: "New recording…", click: toggleQuickRec },
          { label: "Open Pearloom", click: showApp },
          { type: "separator" },
          { role: "quit", label: "Quit Pearloom" },
        ],
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
  // No setContextMenu: left-click opens the quick-record popover when idle
  // (recording controls while recording); right-click opens the menu.
  tray.on("click", () => {
    if (recording) tray?.popUpContextMenu(trayMenu());
    else toggleQuickRec();
  });
  tray.on("right-click", () => tray?.popUpContextMenu(trayMenu()));
  ensureQuickRec();
}

export function recordingStarted(cameraDeviceId: string | null) {
  recording = true;
  paused = false;
  lastElapsedMs = 0;
  tray?.setTitle("🔴 0:00");
  closeQuickRec();
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
  bubble?.webContents.send("event:bubble-paused", paused);
}

export function recordingStopped() {
  if (!recording) return;
  recording = false;
  paused = false;
  tray?.setTitle("🟣");
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
  // Keep the composited camera bubble in the recording glued to wherever the
  // user drags the on-screen bubble (the face circle center, in screen points).
  bubble.on("move", () => {
    const b = bubble?.getBounds();
    if (!b) return;
    deps?.getWindow()?.webContents.send("event:bubble-moved", {
      x: b.x + b.width / 2,
      y: b.y + BUBBLE_FACE_CENTER_Y,
    });
  });
  bubble.on("closed", () => {
    bubble = null;
  });
}

// Face circle center offset inside the bubble window (8px padding + 88px radius).
const BUBBLE_FACE_CENTER_Y = 96;

/** Nudge the bubble window (two-finger scroll over it). */
export function bubbleMoveBy(dx: number, dy: number) {
  if (!bubble || bubble.isDestroyed()) return;
  const b = bubble.getBounds();
  bubble.setBounds({ ...b, x: Math.round(b.x + dx), y: Math.round(b.y + dy) });
}

function closeBubble() {
  if (bubble && !bubble.isDestroyed()) bubble.close();
  bubble = null;
}

function toggleQuickRec() {
  if (quickRec && !quickRec.isDestroyed() && quickRec.isVisible()) {
    closeQuickRec();
  } else {
    openQuickRec();
  }
}

const QUICKREC_W = 320;
const QUICKREC_H = 420;

/**
 * The popover window is created hidden at startup and only shown/hidden
 * afterwards, so tray clicks feel instant (no window creation + bundle load
 * + thumbnail fetch on the click path).
 */
function ensureQuickRec(): BrowserWindow {
  if (quickRec && !quickRec.isDestroyed()) return quickRec;
  quickRec = new BrowserWindow({
    width: QUICKREC_W,
    height: QUICKREC_H,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  quickRec.loadFile(join(__dirname, "../renderer/index.html"), {
    hash: "quickrec",
  });
  quickRec.on("blur", () => closeQuickRec());
  quickRec.on("closed", () => {
    quickRec = null;
  });
  return quickRec;
}

/** Loom-style popover under the tray icon: pick a screen, hit record. */
function openQuickRec() {
  const win = ensureQuickRec();
  const trayBounds = tray?.getBounds();
  const { workArea } = screen.getPrimaryDisplay();
  const x = trayBounds
    ? Math.round(
        Math.min(
          trayBounds.x + trayBounds.width / 2 - QUICKREC_W / 2,
          workArea.x + workArea.width - QUICKREC_W - 8,
        ),
      )
    : workArea.x + workArea.width - QUICKREC_W - 8;
  const y = trayBounds
    ? trayBounds.y + trayBounds.height + 6
    : workArea.y + 8;
  win.setBounds({ x, y, width: QUICKREC_W, height: QUICKREC_H });
  win.webContents.send("event:quickrec-refresh");
  win.show();
}

export function closeQuickRec() {
  if (quickRec && !quickRec.isDestroyed()) quickRec.hide();
}

export function destroyRecordingUi() {
  closeBubble();
  if (quickRec && !quickRec.isDestroyed()) quickRec.destroy();
  quickRec = null;
  tray?.destroy();
  tray = null;
}
