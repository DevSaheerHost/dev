import { describe, expect, it } from "vitest";
import { safeNextPath } from "./redirect";

describe("safeNextPath", () => {
  it("allows relative app paths", () => {
    expect(safeNextPath("/inventory?q=milk")).toBe("/inventory?q=milk");
    expect(safeNextPath("/invite/abc")).toBe("/invite/abc");
  });
  it("blocks open redirects", () => {
    for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)", "/x?u=https://evil", null, 42]) {
      expect(safeNextPath(bad)).toBe("/dashboard");
    }
  });
});
