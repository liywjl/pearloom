import * as esbuild from "esbuild";
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const watch = process.argv.includes("--watch");

// The main process bundles the Pear P2P stack (corestore, hyperswarm, ...),
// which ships native .node addons and dynamic requires — keep those external
// and resolved from node_modules at runtime.
const externalNodeModules = [
  "electron",
  "corestore",
  "hyperswarm",
  "hyperdrive",
  "autobase",
  "hyperbee",
  "blind-pairing",
  "z32",
  "hypercore-crypto",
  "b4a",
  "serve-drive",
  "uiohook-napi",
];

/** @type {esbuild.BuildOptions} */
const mainConfig = {
  entryPoints: [join(root, "src/main/index.ts")],
  outfile: join(root, "dist/main/index.js"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: externalNodeModules,
  sourcemap: true,
};

/** @type {esbuild.BuildOptions} */
const preloadConfig = {
  entryPoints: [join(root, "src/preload/index.ts")],
  outfile: join(root, "dist/preload/index.js"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  sourcemap: true,
};

/** @type {esbuild.BuildOptions} */
const rendererConfig = {
  entryPoints: [join(root, "src/renderer/main.tsx")],
  outfile: join(root, "dist/renderer/main.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "chrome120",
  sourcemap: true,
  loader: { ".svg": "dataurl" },
};

function copyStatic() {
  mkdirSync(join(root, "dist/renderer"), { recursive: true });
  cpSync(
    join(root, "src/renderer/index.html"),
    join(root, "dist/renderer/index.html"),
  );
  cpSync(
    join(root, "src/renderer/styles.css"),
    join(root, "dist/renderer/styles.css"),
  );
}

if (watch) {
  const contexts = await Promise.all([
    esbuild.context(mainConfig),
    esbuild.context(preloadConfig),
    esbuild.context(rendererConfig),
  ]);
  copyStatic();
  await Promise.all(contexts.map((c) => c.watch()));
  console.log(
    "watching for changes... (static files copied once; re-run on html/css change)",
  );
} else {
  await Promise.all([
    esbuild.build(mainConfig),
    esbuild.build(preloadConfig),
    esbuild.build(rendererConfig),
  ]);
  copyStatic();
  console.log("build complete");
}
