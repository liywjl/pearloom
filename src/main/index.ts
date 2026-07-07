import { app, BrowserWindow, protocol } from "electron";
import { join } from "node:path";
import { registerLoomProtocol, LOOM_SCHEME } from "./protocol";
import { RecordingStore } from "./recordings";
import { registerIpcHandlers } from "./ipc";
import { installDisplayMediaHandler, stopClickCapture } from "./capture";
import { destroyRecordingUi, initRecordingUi, isRecording } from "./recui";
import { P2PEngine } from "./p2p/engine";

// Must run before app is ready.
protocol.registerSchemesAsPrivileged([
  {
    scheme: LOOM_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

// One instance per data dir: the Corestore takes an exclusive file lock, so a
// second launch would crash on "File descriptor could not be locked".
// (Testing with a second peer uses --user-data-dir, which gets its own lock.)
if (!app.requestSingleInstanceLock()) {
  app.quit();
}
app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: "LoomP2P",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: "#0f1117",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Critical for recording: keeps timers + canvas compositing at full
      // rate while the user works in OTHER apps (our window is backgrounded).
      backgroundThrottling: false,
    },
  });

  mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  if (process.argv.includes("--devtools")) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  // Dev/CI helper: `electron . --screenshot out.png` captures the UI and quits.
  const shotIdx = process.argv.indexOf("--screenshot");
  const outPath = shotIdx !== -1 ? process.argv[shotIdx + 1] : undefined;
  if (outPath) {
    mainWindow.webContents.once("did-finish-load", () => {
      setTimeout(async () => {
        try {
          const image = await mainWindow!.webContents.capturePage();
          const { writeFile } = await import("node:fs/promises");
          await writeFile(outPath, image.toPNG());
        } finally {
          app.quit();
        }
      }, 1500);
    });
  }
  // The renderer owns the live MediaRecorder — closing the window would kill
  // an active recording, so hide instead (the tray keeps the controls).
  mainWindow.on("close", (event) => {
    if (isRecording()) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  const userData = app.getPath("userData");
  const recordings = new RecordingStore(join(userData, "recordings"));
  await recordings.ready();

  const p2p = new P2PEngine({
    storageDir: join(userData, "p2p"),
    cacheDir: join(userData, "cache"),
    recordings,
  });
  // The engine starts lazily; spaces are reopened on demand at first use.
  await p2p.ready();

  registerLoomProtocol(recordings, p2p);
  installDisplayMediaHandler();
  registerIpcHandlers({ recordings, p2p, getWindow: () => mainWindow });
  initRecordingUi({ getWindow: () => mainWindow });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  app.on("before-quit", async (event) => {
    if (p2p.closing) return;
    event.preventDefault();
    stopClickCapture();
    destroyRecordingUi();
    try {
      await p2p.close();
    } finally {
      app.quit();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
