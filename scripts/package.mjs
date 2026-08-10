import { packager } from "@electron/packager";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const archArg = process.argv.find((a) => a.startsWith("--arch="));
const arch = archArg ? archArg.split("=")[1] : process.arch;

// Signing is opt-in (MACOS_SIGN=1) so local `npm run package` stays unsigned.
// The identity is discovered from the keychain by osx-sign; CI imports the
// Developer ID certificate into a throwaway keychain first.
const sign = process.env.MACOS_SIGN === "1";

// Notarization accepts either credential style; whichever is configured wins.
// App-specific password: APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID
// App Store Connect API key: APPLE_API_KEY (path to .p8) + APPLE_API_KEY_ID + APPLE_API_ISSUER
function notarizeOptions() {
  const {
    APPLE_ID,
    APPLE_APP_SPECIFIC_PASSWORD,
    APPLE_TEAM_ID,
    APPLE_API_KEY,
    APPLE_API_KEY_ID,
    APPLE_API_ISSUER,
  } = process.env;
  if (APPLE_API_KEY && APPLE_API_KEY_ID && APPLE_API_ISSUER) {
    return {
      appleApiKey: APPLE_API_KEY,
      appleApiKeyId: APPLE_API_KEY_ID,
      appleApiIssuer: APPLE_API_ISSUER,
    };
  }
  if (APPLE_ID && APPLE_APP_SPECIFIC_PASSWORD && APPLE_TEAM_ID) {
    return {
      appleId: APPLE_ID,
      appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
      teamId: APPLE_TEAM_ID,
    };
  }
  return undefined;
}

const osxNotarize = sign ? notarizeOptions() : undefined;
if (sign && !osxNotarize) {
  console.warn(
    "MACOS_SIGN=1 but no notarization credentials found — app will be signed but NOT notarized (Gatekeeper will still block downloads).",
  );
}

const appPaths = await packager({
  dir: root,
  name: "Pearloom",
  platform: "darwin",
  arch,
  out: join(root, "out"),
  overwrite: true,
  icon: join(root, "build/icon.icns"),
  extendInfo: join(root, "build/Info.extend.plist"),
  appBundleId: "com.pearloom.app",
  appCategoryType: "public.app-category.video",
  ignore: [/^\/(src|tests|scripts|build|site|\.claude|\.github)($|\/)/, /\.(ts|tsx|map)$/],
  osxSign: sign
    ? {
        optionsForFile: () => ({
          entitlements: join(root, "build/entitlements.plist"),
        }),
      }
    : undefined,
  osxNotarize,
});

console.log(
  `packaged${sign ? " + signed" : ""}${osxNotarize ? " + notarized" : ""}: ${appPaths.join(", ")}`,
);
