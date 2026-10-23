import type { JsonValue, NormalizedValue } from "./types.js";

export function normalize(value: unknown): NormalizedValue {
  return (normalizeValue(value, new WeakSet<object>()) ?? null) as JsonValue;
}

function normalizeValue(
  value: unknown,
  ancestors: WeakSet<object>,
): JsonValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "bigint") return value.toString();
  if (typeof value === "undefined") return undefined;
  if (typeof value === "symbol" || typeof value === "function") return String(value);

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString();
  }

  if (ancestors.has(value)) return "[Circular]";
  ancestors.add(value);

  try {
    if (value instanceof Map) {
      return Array.from(value, ([key, entry]) => [
        normalizeValue(key, ancestors) ?? null,
        normalizeValue(entry, ancestors) ?? null,
      ]);
    }

    if (value instanceof Set) {
      return Array.from(value, (entry) => normalizeValue(entry, ancestors) ?? null);
    }

    if (Array.isArray(value)) {
      const result: JsonValue[] = [];
      for (const entry of value) {
        const normalized = normalizeValue(entry, ancestors);
        if (normalized !== undefined) result.push(normalized);
      }
      return result;
    }

    const result: { [key: string]: JsonValue } = {};
    for (const key of Object.keys(value)) {
      const normalized = normalizeValue(
        (value as Record<string, unknown>)[key],
        ancestors,
      );
      if (normalized !== undefined) {
        Object.defineProperty(result, key, {
          value: normalized,
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}
