import { describe, expect, it } from "vitest";
import { formatDuration, formatSize } from "./format";

describe("formatDuration", () => {
  it("formats sub-hour as m:ss", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(1_000)).toBe("0:01");
    expect(formatDuration(65_000)).toBe("1:05");
    expect(formatDuration(599_000)).toBe("9:59");
  });

  it("formats hours as h:mm:ss", () => {
    expect(formatDuration(3_600_000)).toBe("1:00:00");
    expect(formatDuration(3_661_000)).toBe("1:01:01");
  });

  it("rounds to the nearest second and clamps negatives", () => {
    expect(formatDuration(1_499)).toBe("0:01");
    expect(formatDuration(1_500)).toBe("0:02");
    expect(formatDuration(-5)).toBe("0:00");
  });
});

describe("formatSize", () => {
  it("picks sensible units", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(2048)).toBe("2 KB");
    expect(formatSize(5 * 1024 ** 2)).toBe("5.0 MB");
    expect(formatSize(3 * 1024 ** 3)).toBe("3.00 GB");
  });
});
