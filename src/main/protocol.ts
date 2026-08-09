import { protocol } from "electron";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { parseRange } from "./http-range";
import type { RecordingStore } from "./recordings";
import type { P2PEngine } from "./p2p/engine";

export const PEARLOOM_SCHEME = "pearloom";

/**
 * pearloom://media/recordings/<id> — streams a local recording with Range support
 * so <video> can seek without loading the whole file.
 */
export function registerPearloomProtocol(
  recordings: RecordingStore,
  _p2p: P2PEngine,
) {
  protocol.handle(PEARLOOM_SCHEME, async (request) => {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    if (url.host !== "media" || parts[0] !== "recordings" || !parts[1]) {
      return new Response("not found", { status: 404 });
    }
    const meta = recordings.get(parts[1]);
    if (!meta) return new Response("not found", { status: 404 });

    const path = recordings.filePath(meta.id);
    let size: number;
    try {
      size = (await stat(path)).size;
    } catch {
      return new Response("gone", { status: 404 });
    }

    const range = parseRange(request.headers.get("range"), size);
    const stream = createReadStream(
      path,
      range ? { start: range.start, end: range.end } : {},
    );
    const body = Readable.toWeb(stream) as unknown as ReadableStream;

    const headers: Record<string, string> = {
      "Content-Type": meta.mimeType || "video/webm",
      "Accept-Ranges": "bytes",
    };
    if (range) {
      headers["Content-Range"] = `bytes ${range.start}-${range.end}/${size}`;
      headers["Content-Length"] = String(range.end - range.start + 1);
      return new Response(body, { status: 206, headers });
    }
    headers["Content-Length"] = String(size);
    return new Response(body, { status: 200, headers });
  });
}
