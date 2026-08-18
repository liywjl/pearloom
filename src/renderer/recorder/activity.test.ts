import { describe, expect, it } from "vitest";
import {
  createActivityTrack,
  MAX_ACTIVITY_EVENTS,
  TYPING_GAP_MS,
} from "./activity";

describe("createActivityTrack", () => {
  it("passes clicks through as instants", () => {
    const track = createActivityTrack();
    track.push({ kind: "click", atMs: 100 });
    track.push({ kind: "click", atMs: 150 });
    expect(track.events).toEqual([
      { kind: "click", atMs: 100 },
      { kind: "click", atMs: 150 },
    ]);
  });

  it("coalesces keydowns within the gap into one typing burst", () => {
    const track = createActivityTrack();
    track.push({ kind: "typing", atMs: 1000 });
    track.push({ kind: "typing", atMs: 1000 + TYPING_GAP_MS - 1 });
    track.push({ kind: "typing", atMs: 1000 + 2 * (TYPING_GAP_MS - 1) });
    expect(track.events).toEqual([
      { kind: "typing", atMs: 1000, endMs: 1000 + 2 * (TYPING_GAP_MS - 1) },
    ]);
  });

  it("starts a new burst after the gap", () => {
    const track = createActivityTrack();
    track.push({ kind: "typing", atMs: 1000 });
    track.push({ kind: "typing", atMs: 1000 + TYPING_GAP_MS });
    expect(track.events).toHaveLength(2);
  });

  it("a click between keydowns splits the burst", () => {
    const track = createActivityTrack();
    track.push({ kind: "typing", atMs: 1000 });
    track.push({ kind: "click", atMs: 1200 });
    track.push({ kind: "typing", atMs: 1400 });
    expect(track.events.map((e) => e.kind)).toEqual([
      "typing",
      "click",
      "typing",
    ]);
  });

  it("caps the number of events but keeps extending the last burst", () => {
    const track = createActivityTrack();
    for (let i = 0; i < MAX_ACTIVITY_EVENTS + 100; i++) {
      track.push({ kind: "click", atMs: i * 10_000 });
    }
    expect(track.events).toHaveLength(MAX_ACTIVITY_EVENTS);
    const lastClickAt = track.events[track.events.length - 1]!.atMs;

    track.push({ kind: "typing", atMs: lastClickAt + 10_000 });
    expect(track.events).toHaveLength(MAX_ACTIVITY_EVENTS);
  });
});
