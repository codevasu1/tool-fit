import type { SliceOptions } from "./types.js";

export function slice<T>(original: T, pointer: string, options: SliceOptions): unknown {
  validateRange(options);
  if (pointer !== "" && !pointer.startsWith("/")) {
    throw new TypeError("pointer must be an empty string or a JSON Pointer.");
  }

  let value: unknown = original;
  if (pointer !== "") {
    for (const encodedSegment of pointer.slice(1).split("/")) {
      const segment = encodedSegment.replace(/~1/g, "/").replace(/~0/g, "~");
      if (Array.isArray(value)) {
        const index = Number(segment);
        if (!Number.isInteger(index) || index < 0 || index >= value.length) {
          throw new RangeError(`Array index "${segment}" does not exist at "${pointer}".`);
        }
        value = value[index];
      } else if (typeof value === "object" && value !== null) {
        if (!Object.prototype.hasOwnProperty.call(value, segment)) {
          throw new RangeError(`Property "${segment}" does not exist at "${pointer}".`);
        }
        value = (value as Record<string, unknown>)[segment];
      } else {
        throw new RangeError(`Cannot resolve "${pointer}" through a primitive value.`);
      }
    }
  }

  if (Array.isArray(value) || typeof value === "string") {
    return value.slice(options.offset, options.offset + options.limit);
  }
  throw new TypeError(`The value at "${pointer || "/"}" is not an array or string.`);
}

function validateRange(options: SliceOptions): void {
  if (
    !Number.isInteger(options.offset) ||
    options.offset < 0 ||
    !Number.isInteger(options.limit) ||
    options.limit < 0
  ) {
    throw new TypeError("offset and limit must be non-negative integers.");
  }
}
