import { createRequire } from "node:module";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron, type ElectronApplication, type Page } from "playwright-core";
import type { RecordingMeta } from "../../src/shared/types";

const require = createRequire(import.meta.url);
const electronPath = require("electron") as unknown as string;
export const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

/** Fresh user-data dir, optionally seeded with local recordings. */
export async function makeUserDataDir(
  recordings: Array<Partial<RecordingMeta> & { id: string; title: string }> = [],
): Promise<string> {
  // realpath: macOS tmpdir is a /private symlink, and Electron reports the
  // resolved path from app.getPath("userData").
  const dir = await realpath(await mkdtemp(join(tmpdir(), "pearloom-e2e-")));
  if (recordings.length > 0) {
    const recDir = join(dir, "recordings");
    await mkdir(recDir, { recursive: true });
    const metas: RecordingMeta[] = recordings.map((r) => ({
      createdAt: Date.now(),
      durationMs: 30_000,
      sizeBytes: 10,
      mimeType: "video/webm",
      thumbnailDataUrl: null,
      sharedTo: [],
      activity: [],
      tags: [],
      ...r,
    }));
    await writeFile(join(recDir, "index.json"), JSON.stringify(metas));
    for (const meta of metas) {
      await writeFile(join(recDir, `${meta.id}.webm`), "FAKE-WEBM-CONTENT");
    }
  }
  return dir;
}

export async function launchApp(userDataDir: string): Promise<ElectronApplication> {
  return _electron.launch({
    executablePath: electronPath,
    args: [projectRoot, `--user-data-dir=${userDataDir}`],
    cwd: projectRoot,
  });
}

/**
 * The app opens several windows on the same bundle (quick-record popover,
 * face bubble, main) — pick one by its location hash.
 */
export async function windowByHash(
  app: ElectronApplication,
  match: (hash: string) => boolean,
  timeoutMs = 20_000,
): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    for (const page of app.windows()) {
      try {
        const hash = new URL(page.url()).hash;
        if (match(hash)) {
          await page.waitForLoadState("domcontentloaded");
          return page;
        }
      } catch {
        /* window may be mid-navigation */
      }
    }
    if (Date.now() > deadline) {
      const urls = app.windows().map((w) => w.url());
      throw new Error(`no window matched; open windows: ${urls.join(", ")}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

export const mainWindow = (app: ElectronApplication) =>
  windowByHash(app, (h) => !h.startsWith("#quickrec") && !h.startsWith("#bubble"));

export const quickRecWindow = (app: ElectronApplication) =>
  windowByHash(app, (h) => h.startsWith("#quickrec"));
