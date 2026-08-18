import type { ActivityEvent } from "../../shared/types";

/**
 * Collects the click/typing activity track for a recording. Keydowns coalesce
 * into typing bursts, and the track is capped so a marathon recording can't
 * bloat the metadata.
 */
export interface ActivityTrack {
  readonly events: ActivityEvent[];
  push(event: ActivityEvent): void;
}

export const MAX_ACTIVITY_EVENTS = 4000;
export const TYPING_GAP_MS = 1500;

export function createActivityTrack(): ActivityTrack {
  const events: ActivityEvent[] = [];
  return {
    events,
    push(event) {
      if (event.kind === "typing") {
        const last = events[events.length - 1];
        if (
          last?.kind === "typing" &&
          event.atMs - (last.endMs ?? last.atMs) < TYPING_GAP_MS
        ) {
          last.endMs = event.atMs;
          return;
        }
      }
      if (events.length < MAX_ACTIVITY_EVENTS) events.push(event);
    },
  };
}
