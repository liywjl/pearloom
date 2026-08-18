import { describe, expect, it } from "vitest";
import { ACTIVE_WINDOW_MS, pickActiveComment } from "./active-comment";
import type { CommentRecord } from "../../shared/types";

const comment = (overrides: Partial<CommentRecord>): CommentRecord => ({
  id: Math.random().toString(36).slice(2),
  spaceId: "s",
  recordingId: "r",
  author: "alice",
  authorKey: "k",
  text: "hi",
  atMs: null,
  endMs: null,
  createdAt: 0,
  likeCount: 0,
  likedByMe: false,
  ...overrides,
});

describe("pickActiveComment", () => {
  it("surfaces a point comment for the active window only", () => {
    const c = comment({ atMs: 10_000 });
    expect(pickActiveComment([c], 9_999)).toBeNull();
    expect(pickActiveComment([c], 10_000)?.id).toBe(c.id);
    expect(pickActiveComment([c], 10_000 + ACTIVE_WINDOW_MS)?.id).toBe(c.id);
    expect(pickActiveComment([c], 10_001 + ACTIVE_WINDOW_MS)).toBeNull();
  });

  it("surfaces a section comment for its whole range", () => {
    const c = comment({ atMs: 5_000, endMs: 60_000 });
    expect(pickActiveComment([c], 5_000)?.id).toBe(c.id);
    expect(pickActiveComment([c], 59_999)?.id).toBe(c.id);
    expect(pickActiveComment([c], 60_001)).toBeNull();
  });

  it("prefers the most recently started when several overlap", () => {
    const long = comment({ atMs: 0, endMs: 100_000 });
    const recent = comment({ atMs: 40_000 });
    expect(pickActiveComment([long, recent], 41_000)?.id).toBe(recent.id);
    expect(pickActiveComment([long, recent], 80_000)?.id).toBe(long.id);
  });

  it("ignores comments without a timestamp", () => {
    expect(pickActiveComment([comment({ atMs: null })], 0)).toBeNull();
  });

  it("works at 0ms", () => {
    const c = comment({ atMs: 0 });
    expect(pickActiveComment([c], 0)?.id).toBe(c.id);
  });
});
