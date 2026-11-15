import { describe, expect, it } from "vitest";
import { oneOf, pageNumber } from "./search";

describe("query param sanitizing", () => {
  it("validates pages and enums", () => {
    expect(pageNumber("3")).toBe(3);
    expect(pageNumber("-1")).toBe(1);
    expect(pageNumber("1e9")).toBe(1);
    expect(oneOf("qty", ["name", "qty"] as const, "name")).toBe("qty");
    expect(oneOf("drop", ["name", "qty"] as const, "name")).toBe("name");
  });
});
