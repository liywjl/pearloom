import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Wraps a packaged Pearloom.app into a drag-to-Applications DMG.
 * With MACOS_SIGN=1 the DMG itself is signed, notarized and stapled
 * (same credential styles as package.mjs; the .app inside is expected
 * to already be signed + notarized by the package step).
 *
 * Usage: node scripts/dmg.mjs [--arch=arm64|x64] [--out=path.dmg]
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const argValue = (name, fallback) => {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split("=").slice(1).join("=") : fallback;
};

const arch = argValue("arch", process.arch);
const appPath = join(root, `out/Pearloom-darwin-${arch}/Pearloom.app`);
const dmgPath = resolve(root, argValue("out", `out/Pearloom-${arch}.dmg`));

const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit" });

const staging = mkdtempSync(join(tmpdir(), "pearloom-dmg-"));
try {
  // ditto, not fs.cpSync: only ditto preserves the bundle exactly (symlinks,
  // extended attributes) — cpSync breaks the code signature, and Apple then
  // rejects the DMG's notarization with "signature of the binary is invalid".
  run("ditto", [appPath, join(staging, "Pearloom.app")]);
  if (process.env.MACOS_SIGN === "1") {
    // Fail here, in seconds, if the copy broke the app signature — not after
    // a multi-minute notarization round-trip.
    run("codesign", ["--verify", "--strict", "--deep", join(staging, "Pearloom.app")]);
  }
  symlinkSync("/Applications", join(staging, "Applications"));
  rmSync(dmgPath, { force: true });
  // hdiutil intermittently fails with "Resource busy" on CI (a race with
  // macOS's disk-image daemon) — retry like electron-builder does.
  const hdiutilArgs = [
    "create",
    "-volname",
    "Pearloom",
    "-srcfolder",
    staging,
    "-format",
    "UDZO",
    "-ov",
    dmgPath,
  ];
  for (let attempt = 1; ; attempt++) {
    try {
      run("hdiutil", hdiutilArgs);
      break;
    } catch (err) {
      if (attempt >= 5) throw err;
      console.warn(`hdiutil create failed (attempt ${attempt}/5), retrying…`);
      execFileSync("sleep", ["3"]);
    }
  }
} finally {
  rmSync(staging, { recursive: true, force: true });
}

const sign = process.env.MACOS_SIGN === "1";
if (sign) {
  // Partial identity match: codesign resolves it against the keychain.
  // Notarization requires a secure timestamp on the DMG signature.
  run("codesign", ["--sign", "Developer ID Application", "--timestamp", dmgPath]);

  const {
    APPLE_KEYCHAIN_PROFILE,
    APPLE_ID,
    APPLE_APP_SPECIFIC_PASSWORD,
    APPLE_TEAM_ID,
    APPLE_API_KEY,
    APPLE_API_KEY_ID,
    APPLE_API_ISSUER,
  } = process.env;
  let credentials = null;
  if (APPLE_KEYCHAIN_PROFILE) {
    credentials = ["--keychain-profile", APPLE_KEYCHAIN_PROFILE];
  } else if (APPLE_API_KEY && APPLE_API_KEY_ID && APPLE_API_ISSUER) {
    credentials = [
      "--key",
      APPLE_API_KEY,
      "--key-id",
      APPLE_API_KEY_ID,
      "--issuer",
      APPLE_API_ISSUER,
    ];
  } else if (APPLE_ID && APPLE_APP_SPECIFIC_PASSWORD && APPLE_TEAM_ID) {
    credentials = [
      "--apple-id",
      APPLE_ID,
      "--password",
      APPLE_APP_SPECIFIC_PASSWORD,
      "--team-id",
      APPLE_TEAM_ID,
    ];
  }
  if (!credentials) {
    throw new Error(
      "MACOS_SIGN=1 but no notarization credentials — a signed-only DMG would ship un-notarized.",
    );
  }

  // `notarytool submit --wait` exits 0 even when the verdict is Invalid —
  // parse the JSON result and fetch the log so CI shows the real reason.
  const submitOut = execFileSync(
    "xcrun",
    [
      "notarytool",
      "submit",
      dmgPath,
      "--wait",
      "--output-format",
      "json",
      ...credentials,
    ],
    { encoding: "utf8" },
  );
  const submission = JSON.parse(submitOut);
  if (submission.status !== "Accepted") {
    console.error(`notarization ${submission.status} (id ${submission.id}):`);
    try {
      run("xcrun", ["notarytool", "log", submission.id, ...credentials]);
    } catch {
      /* log fetch is best-effort */
    }
    throw new Error(`DMG notarization ${submission.status}`);
  }
  run("xcrun", ["stapler", "staple", dmgPath]);
}

console.log(`dmg${sign ? " + signed" : ""}: ${dmgPath}`);
