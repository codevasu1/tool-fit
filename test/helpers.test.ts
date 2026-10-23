import { describe, expect, it } from "vitest";
import { slice, wrapTool } from "../src/index.js";

describe("slice", () => {
  it("retrieves an array or string range through JSON Pointer paths", () => {
    const original = { "a/b": { text: "abcdef" }, items: [0, 1, 2, 3, 4] };

    expect(slice(original, "/items", { offset: 2, limit: 2 })).toEqual([2, 3]);
    expect(slice(original, "/a~1b/text", { offset: 1, limit: 3 })).toBe("bcd");
  });

  it("rejects invalid paths and ranges", () => {
    expect(() => slice({ a: 1 }, "/missing", { offset: 0, limit: 1 })).toThrow(
      RangeError,
    );
    expect(() => slice({ text: "abc" }, "/text/x", { offset: 0, limit: 1 })).toThrow(
      RangeError,
    );
    expect(() => slice("abc", "", { offset: -1, limit: 1 })).toThrow(TypeError);
  });
});

describe("wrapTool", () => {
  it("fits synchronous and asynchronous tool results", async () => {
    const sync = wrapTool((id: string) => ({ id, text: "x".repeat(100) }), {
      maxTokens: 40,
      countTokens: (text) => text.length,
    });
    const async = wrapTool(async (id: string) => ({ id, text: "y".repeat(100) }), {
      maxTokens: 40,
      countTokens: (text) => text.length,
    });

    expect(sync("42").truncated).toBe(true);
    expect((await async("42")).truncated).toBe(true);
  });
});
