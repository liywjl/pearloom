import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
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
  cpSync(appPath, join(staging, "Pearloom.app"), { recursive: true });
  symlinkSync("/Applications", join(staging, "Applications"));
  rmSync(dmgPath, { force: true });
  run("hdiutil", [
    "create",
    "-volname",
    "Pearloom",
    "-srcfolder",
    staging,
    "-format",
    "UDZO",
    dmgPath,
  ]);
} finally {
  rmSync(staging, { recursive: true, force: true });
}

const sign = process.env.MACOS_SIGN === "1";
if (sign) {
  // Partial identity match: codesign resolves it against the keychain.
  run("codesign", ["--sign", "Developer ID Application", dmgPath]);

  const {
    APPLE_KEYCHAIN_PROFILE,
    APPLE_ID,
    APPLE_APP_SPECIFIC_PASSWORD,
    APPLE_TEAM_ID,
  } = process.env;
  let credentials = null;
  if (APPLE_KEYCHAIN_PROFILE) {
    credentials = ["--keychain-profile", APPLE_KEYCHAIN_PROFILE];
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
  if (credentials) {
    run("xcrun", ["notarytool", "submit", dmgPath, "--wait", ...credentials]);
    run("xcrun", ["stapler", "staple", dmgPath]);
  } else {
    console.warn("MACOS_SIGN=1 but no notarization credentials — DMG signed only.");
  }
}

console.log(`dmg${sign ? " + signed" : ""}: ${dmgPath}`);
