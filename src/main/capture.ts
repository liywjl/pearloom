import {
  desktopCapturer,
  screen,
  session,
  systemPreferences,
  shell,
} from "electron";
import type {
  DisplaySource,
  GlobalClick,
  MediaAccessKind,
  MediaAccessStatus,
} from "../shared/types";

/**
 * The renderer drives its own picker UI: it lists sources, tells us which one
 * the user chose, then calls getDisplayMedia(). The handler installed here
 * resolves that request with the armed source.
 */
let armedSourceId: string | null = null;

export function armDisplaySource(sourceId: string) {
  armedSourceId = sourceId;
}

export async function listDisplaySources(): Promise<DisplaySource[]> {
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 480, height: 300 },
    fetchWindowIcons: true,
  });
  const displays = screen.getAllDisplays();
  return sources
    .filter((s) => !s.thumbnail.isEmpty())
    .map((s) => {
      const display = displays.find((d) => String(d.id) === s.display_id);
      return {
        id: s.id,
        name: s.name,
        kind: s.id.startsWith("screen")
          ? ("screen" as const)
          : ("window" as const),
        thumbnailDataUrl: s.thumbnail.toDataURL(),
        appIconDataUrl:
          s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
        displayBounds: display ? { ...display.bounds } : null,
      };
    });
}

// ---- global activity capture (click ripples + typing timeline) -------------
//
// uiohook-napi (N-API prebuilt, main process only) provides click/keydown
// TIMING. Click coordinates are deliberately read from Electron's
// screen.getCursorScreenPoint() instead of the hook event: it is always in the
// same display-point space as display.bounds (uiohook coordinates are not
// reliable across Retina scale factors — clicks silently mapped off-frame).
// On macOS the hook needs the Accessibility permission; without it we record
// without click/typing capture. Only timing is captured — never key contents.

type ClickListener = (click: GlobalClick) => void;
type KeyListener = () => void;
let clickListener: ClickListener | null = null;
let keyListener: KeyListener | null = null;
let hookRunning = false;
let hookWired = false;

export function clickCaptureAvailable(): boolean {
  if (process.platform !== "darwin") return true;
  return systemPreferences.isTrustedAccessibilityClient(false);
}

/** Pops the macOS Accessibility consent dialog (no-op if already granted). */
export function requestClickCaptureAccess(): boolean {
  if (process.platform !== "darwin") return true;
  return systemPreferences.isTrustedAccessibilityClient(true);
}

export function startClickCapture(
  onClick: ClickListener,
  onKey?: KeyListener,
): boolean {
  if (!clickCaptureAvailable()) return false;
  try {
    // Lazy-require so a missing/broken native module can never take down boot.
    const { uIOhook } =
      require("uiohook-napi") as typeof import("uiohook-napi");
    if (!hookWired) {
      uIOhook.on("mousedown", () => {
        const { x, y } = screen.getCursorScreenPoint();
        clickListener?.({ x, y });
      });
      uIOhook.on("keydown", () => {
        keyListener?.();
      });
      hookWired = true;
    }
    clickListener = onClick;
    keyListener = onKey ?? null;
    if (!hookRunning) {
      uIOhook.start();
      hookRunning = true;
    }
    return true;
  } catch (err) {
    console.error("click capture unavailable:", err);
    clickListener = null;
    keyListener = null;
    return false;
  }
}

export function stopClickCapture(): void {
  clickListener = null;
  keyListener = null;
  if (!hookRunning) return;
  try {
    const { uIOhook } =
      require("uiohook-napi") as typeof import("uiohook-napi");
    uIOhook.stop();
  } catch {
    /* already dead */
  }
  hookRunning = false;
}

// ---- cursor tracking (persistent red dot burned into the video) ------------
//
// Electron can read the cursor position without any permission, so the dot
// works even when Accessibility (and thus click capture) is unavailable, and
// even though macOS screen capture streams usually exclude the cursor.

let cursorTimer: ReturnType<typeof setInterval> | null = null;

export function startCursorTracking(
  onPos: (pos: { x: number; y: number }) => void,
): void {
  stopCursorTracking();
  let last = { x: NaN, y: NaN };
  cursorTimer = setInterval(() => {
    const p = screen.getCursorScreenPoint();
    if (p.x !== last.x || p.y !== last.y) {
      last = p;
      onPos(p);
    }
  }, 33);
}

export function stopCursorTracking(): void {
  if (cursorTimer) clearInterval(cursorTimer);
  cursorTimer = null;
}

export function installDisplayMediaHandler() {
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      const wanted = armedSourceId;
      armedSourceId = null;
      desktopCapturer
        .getSources({ types: ["screen", "window"] })
        .then((sources) => {
          const source = sources.find((s) => s.id === wanted) ?? sources[0];
          if (!source) throw new Error("no capturable sources");
          callback({ video: source });
        })
        .catch(() => {
          // Passing no streams denies the request; the renderer surfaces the error.
          callback({});
        });
    },
    { useSystemPicker: false },
  );
}

export async function askMediaAccess(
  kind: MediaAccessKind,
): Promise<MediaAccessStatus> {
  if (process.platform !== "darwin") return "granted";
  if (kind === "screen") {
    // macOS screen-recording consent can't be requested programmatically; the
    // first capture attempt registers the app in System Settings. If denied,
    // deep-link the user there.
    const status = systemPreferences.getMediaAccessStatus("screen");
    if (status !== "granted") {
      await shell.openExternal(
        "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
      );
    }
    return status as MediaAccessStatus;
  }
  const granted = await systemPreferences.askForMediaAccess(kind);
  return granted
    ? "granted"
    : (systemPreferences.getMediaAccessStatus(kind) as MediaAccessStatus);
}

export function mediaAccessStatus(kind: MediaAccessKind): MediaAccessStatus {
  if (process.platform !== "darwin") return "granted";
  return systemPreferences.getMediaAccessStatus(kind) as MediaAccessStatus;
}
