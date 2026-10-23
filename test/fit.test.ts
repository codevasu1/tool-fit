import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { fit, normalize } from "../src/index.js";

describe("fit", () => {
  it("returns an already-fitting value by reference", () => {
    const input = { id: "issue-1", labels: ["bug", "good first issue"] };
    const result = fit(input, { maxTokens: 100, countTokens: (text) => text.length });

    expect(result.value).toBe(input);
    expect(result.truncated).toBe(false);
    expect(result.omitted).toEqual([]);
  });

  it("reduces strings and reports omitted characters", () => {
    const result = fit("a".repeat(200), {
      maxTokens: 48,
      countTokens: (text) => text.length,
    });

    expect(result.truncated).toBe(true);
    expect(result.tokens).toBeLessThanOrEqual(48);
    expect(result.value).toContain("[+");
    expect(result.omitted).toMatchObject([
      { path: "", kind: "string", total: 200 },
    ]);
    expect(result.omitted[0]!.kept + result.omitted[0]!.dropped).toBe(200);
  });

  it("cuts multiline strings on line boundaries", () => {
    const result = fit("line\n".repeat(80), {
      maxTokens: 45,
      countTokens: (text) => text.length,
    });
    const output = result.value as string;
    const markerStart = output.indexOf("…[+");
    const markerEnd = output.indexOf("]", markerStart) + 1;

    expect(output.slice(0, markerStart)).toMatch(/\n$/);
    expect(output.slice(markerEnd)).toMatch(/^\n/);
  });

  it("keeps object keys while allocating across large siblings", () => {
    const input = {
      status: "open",
      issue: "x".repeat(200),
      comments: "y".repeat(200),
      id: "42",
    };
    const result = fit(input, {
      maxTokens: 100,
      countTokens: (text) => text.length,
    });
    const output = result.value as typeof input;

    expect(Object.keys(output)).toEqual(Object.keys(input));
    expect(output.status).toBe("open");
    expect(output.id).toBe("42");
    expect(result.tokens).toBeLessThanOrEqual(100);
    expect(result.omitted).toHaveLength(2);
  });

  it("honors minimum item and character floors when they fit", () => {
    const input = { rows: ["a".repeat(100), "b".repeat(100), "c".repeat(100)] };
    const result = fit(input, {
      maxTokens: 120,
      minItems: 2,
      minChars: 5,
      countTokens: (text) => text.length,
    });
    const rows = (result.value as { rows: string[] }).rows.filter(
      (row) => !row.startsWith("…[+"),
    );

    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((row) => Array.from(row).length >= 5)).toBe(true);
    expect(result.tokens).toBeLessThanOrEqual(120);
  });

  it("prefers retaining tiny strings over larger inline markers", () => {
    const result = fit(Array.from({ length: 100 }, () => "x"), {
      maxTokens: 120,
      countTokens: (text) => text.length,
    });
    const values = result.value as string[];

    expect(values.filter((value) => value === "x").length).toBeGreaterThan(10);
    expect(values.at(-1)).toMatch(/^…\[\+/);
    expect(result.tokens).toBeLessThanOrEqual(120);
  });

  it("keeps named fields untouched", () => {
    const input = {
      id: "x".repeat(100),
      nested: { status: "ok" },
      body: "y".repeat(200),
    };
    const result = fit(input, {
      maxTokens: 180,
      keep: ["id", "status"],
      countTokens: (text) => text.length,
    });

    expect(result.value).toMatchObject({ id: input.id, nested: input.nested });
    expect((result.value as typeof input).body.length).toBeLessThan(input.body.length);
    expect(result.tokens).toBeLessThanOrEqual(180);
  });

  it("supports sidecar omissions without inline marker values", () => {
    const result = fit({ rows: ["a", "b", "c", "d", "e"] }, {
      maxTokens: 14,
      countTokens: (text) => text.length,
      marker: "sidecar",
    });

    expect(Array.isArray((result.value as { rows: unknown[] }).rows)).toBe(true);
    expect(JSON.stringify(result.value)).not.toContain("…[+");
    expect(result.omitted.some((entry) => entry.path === "/rows")).toBe(true);
  });

  it("throws if an irreducible value cannot fit", () => {
    expect(() =>
      fit(123456, { maxTokens: 1, countTokens: (text) => text.length }),
    ).toThrow(RangeError);
  });

  it("validates the output and budget for generated JSON-like data", () => {
    fc.assert(
      fc.property(
        fc.jsonValue(),
        fc.integer({ min: 80, max: 180 }),
        (input, maxTokens) => {
          const result = fit(input, {
            maxTokens,
            countTokens: (text) => text.length,
          });
          expect(result.tokens).toBeLessThanOrEqual(maxTokens);
          expect(() => JSON.stringify(result.value)).not.toThrow();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("does not mutate its input and returns deterministic output", () => {
    const input = { list: ["a".repeat(100), "b".repeat(100)] };
    const snapshot = structuredClone(input);
    const options = { maxTokens: 60, countTokens: (text: string) => text.length };

    expect(fit(input, options)).toEqual(fit(input, options));
    expect(input).toEqual(snapshot);
  });
});

describe("normalize", () => {
  it("converts odd values and identifies cycles without changing shared objects", () => {
    const shared = { value: 1 };
    const circular: { self?: unknown } = {};
    circular.self = circular;

    expect(
      normalize({
        date: new Date("2024-01-02T03:04:05.000Z"),
        big: 12n,
        skipped: undefined,
        map: new Map([["key", "value"]]),
        set: new Set([1, 2]),
        shared: [shared, shared],
        circular,
      }),
    ).toEqual({
      date: "2024-01-02T03:04:05.000Z",
      big: "12",
      map: [["key", "value"]],
      set: [1, 2],
      shared: [{ value: 1 }, { value: 1 }],
      circular: { self: "[Circular]" },
    });
  });

  it("preserves an own __proto__ data property", () => {
    const input = JSON.parse('{"__proto__":"data","body":"' + "x".repeat(100) + '"}');
    const result = normalize(input) as Record<string, unknown>;

    expect(Object.hasOwn(result, "__proto__")).toBe(true);
    expect(result.__proto__).toBe("data");
  });
});
