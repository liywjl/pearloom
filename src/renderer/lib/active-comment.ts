import type { CommentRecord } from "../../shared/types";

/** How long a point comment stays surfaced while playback passes it. */
export const ACTIVE_WINDOW_MS = 4000;

/**
 * SoundCloud-style comment surfacing: returns the comment the playhead is
 * currently inside — its section for range comments, a few seconds for point
 * comments — preferring the most recently started when several overlap.
 * Comments without a timestamp never surface.
 */
export function pickActiveComment(
  comments: CommentRecord[],
  currentMs: number,
  windowMs: number = ACTIVE_WINDOW_MS,
): CommentRecord | null {
  return (
    comments
      .filter((c) => {
        if (c.atMs === null) return false;
        const end = c.endMs ?? c.atMs + windowMs;
        return currentMs >= c.atMs && currentMs <= end;
      })
      .sort((a, b) => b.atMs! - a.atMs!)[0] ?? null
  );
}
