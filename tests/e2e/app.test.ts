import { rm } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ElectronApplication, Page } from "playwright-core";
import {
  launchApp,
  mainWindow,
  makeUserDataDir,
  quickRecWindow,
} from "./helpers";

/**
 * End-to-end flows against the real built app (run `npm run e2e`).
 * One Electron instance for the whole file; a seeded local recording stands
 * in for a real capture (recording itself needs macOS screen permission).
 */
describe("Pearloom e2e", () => {
  let app: ElectronApplication;
  let page: Page;
  let userDataDir: string;

  beforeAll(async () => {
    userDataDir = await makeUserDataDir([
      { id: "seeded-rec-1", title: "Seeded walkthrough" },
    ]);
    app = await launchApp(userDataDir);
    page = await mainWindow(app);
  });

  afterAll(async () => {
    await app?.close();
    if (userDataDir) await rm(userDataDir, { recursive: true, force: true });
  });

  it("honors --user-data-dir (seed + isolation sanity)", async () => {
    const userData = await app.evaluate(({ app: a }) => a.getPath("userData"));
    expect(userData).toBe(userDataDir);
  });

  it("boots into the record view with navigation", async () => {
    await page.locator("h1", { hasText: "New recording" }).waitFor();
    await page.locator(".sidebar-brand", { hasText: "Pearloom" }).waitFor();
  });

  it("keeps the quick-record popover pre-created and ready", async () => {
    const popover = await quickRecWindow(app);
    await popover.locator(".quickrec-title", { hasText: "New recording" }).waitFor();
    await popover.locator(".quickrec-start", { hasText: "Start recording" }).waitFor();
    // Hidden until the tray is clicked.
    const visible = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some(
        (w) => w.isVisible() && w.getBounds().width === 320,
      ),
    );
    expect(visible).toBe(false);
  });

  it("shows the seeded recording in the library", async () => {
    await page.locator(".nav-item", { hasText: "Library" }).click();
    await page.locator("h1", { hasText: "Library" }).waitFor();
    await page.locator(".rec-title", { hasText: "Seeded walkthrough" }).waitFor();
  });

  it("opens the player with timeline and private-recording state", async () => {
    await page.locator(".rec-thumb").first().click();
    await page.locator(".player-view h1", { hasText: "Seeded walkthrough" }).waitFor();
    await page.locator(".timeline").waitFor();
    await page.locator(".video-frame").waitFor();
    // Not shared anywhere yet — feedback rail offers sharing instead.
    await page
      .locator(".feedback-empty", { hasText: "This recording is private" })
      .waitFor();
    await page.locator(".btn", { hasText: "← Back" }).click();
    await page.locator("h1", { hasText: "Library" }).waitFor();
  });

  it("renames the profile from the sidebar", async () => {
    await page.locator(".profile-chip").click();
    const input = page.locator(".sidebar-footer input");
    await input.fill("Willow");
    await page.locator(".sidebar-footer button", { hasText: "Save" }).click();
    await page.locator(".profile-chip", { hasText: "Willow" }).waitFor();
  });

  it("creates a space and lands in its view", async () => {
    await page.locator("button[title='Create a space']").click();
    const input = page.locator(".sidebar-section input");
    await input.fill("E2E space");
    await page.locator(".inline-form button", { hasText: "Create" }).click();
    await page.locator(".content h1", { hasText: "E2E space" }).waitFor({
      timeout: 30_000,
    });
    await page.locator(".space-item", { hasText: "E2E space" }).waitFor();
  });

  it("reopens the space after restart (persisted spaces)", async () => {
    await app.close();
    app = await launchApp(userDataDir);
    page = await mainWindow(app);
    await page
      .locator(".space-item", { hasText: "E2E space" })
      .waitFor({ timeout: 30_000 });
  });
});
