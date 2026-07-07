import { describe, expect, it } from "vitest";
import { parseRange } from "../src/main/http-range";

describe("parseRange", () => {
  it("returns null without a header", () => {
    expect(parseRange(null, 100)).toBeNull();
  });

  it("parses a bounded range", () => {
    expect(parseRange("bytes=0-49", 100)).toEqual({ start: 0, end: 49 });
  });

  it("parses an open-ended range", () => {
    expect(parseRange("bytes=10-", 100)).toEqual({ start: 10, end: 99 });
  });

  it("parses a suffix range", () => {
    expect(parseRange("bytes=-20", 100)).toEqual({ start: 80, end: 99 });
  });

  it("clamps end to the file size", () => {
    expect(parseRange("bytes=0-1000", 100)).toEqual({ start: 0, end: 99 });
  });

  it("rejects out-of-bounds and malformed ranges", () => {
    expect(parseRange("bytes=100-", 100)).toBeNull();
    expect(parseRange("bytes=50-10", 100)).toBeNull();
    expect(parseRange("bytes=-", 100)).toBeNull();
    expect(parseRange("chunks=0-10", 100)).toBeNull();
  });
});
