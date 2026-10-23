import { allocate } from "./allocate.js";
import { estimateTokens } from "./estimate.js";
import { normalize } from "./normalize.js";
import type { FitOptions, FitResult, JsonValue } from "./types.js";

const DEFAULT_MAX_ITERATIONS = 8;

export function fit<T>(input: T, options: FitOptions): FitResult<T> {
  validateOptions(options);

  const counter = options.countTokens ?? estimateTokens;
  const countTokens = (text: string): number => checkedTokenCount(counter, text);
  const originalText = trySerialize(input);
  if (originalText !== undefined) {
    const tokens = checkedTokenCount(countTokens, originalText);
    if (tokens <= options.maxTokens) {
      return { value: input, omitted: [], tokens, truncated: false };
    }
  }

  const normalized = normalize(input);
  const keepPaths = normalizeKeep(options.keep);
  const marker = options.marker ?? "inline";
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  let budget = options.maxTokens;
  let last: ReturnType<typeof allocate> | undefined;

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    last = allocate(normalized, budget, {
      ...options,
      countTokens,
      marker,
      keepPaths,
    });
    const text = JSON.stringify(last.value);
    const tokens = checkedTokenCount(countTokens, text);
    if (tokens <= options.maxTokens) {
      return {
        value: last.value,
        omitted: last.omitted,
        tokens,
        truncated: true,
      };
    }
    budget = Math.max(0, Math.floor(budget * (options.maxTokens / tokens) * 0.95));
  }

  const output = last ? JSON.stringify(last.value) : JSON.stringify(normalized);
  const tokens = checkedTokenCount(countTokens, output);
  if (tokens > options.maxTokens) {
    throw new RangeError(
      `Unable to fit output into ${options.maxTokens} tokens; the protected or irreducible value requires ${tokens}.`,
    );
  }

  return {
    value: last?.value ?? normalized,
    omitted: last?.omitted ?? [],
    tokens,
    truncated: true,
  };
}

function validateOptions(options: FitOptions): void {
  if (!options || !Number.isFinite(options.maxTokens) || options.maxTokens < 0) {
    throw new TypeError("maxTokens must be a finite, non-negative number.");
  }
  for (const [name, value] of [
    ["minItems", options.minItems],
    ["minChars", options.minChars],
    ["maxDepth", options.maxDepth],
    ["maxIterations", options.maxIterations],
  ] as const) {
    const minimum = name === "maxIterations" ? 1 : 0;
    if (value !== undefined && (!Number.isInteger(value) || value < minimum)) {
      throw new TypeError(`${name} must be an integer greater than or equal to ${minimum}.`);
    }
  }
  if (!Number.isInteger(options.maxTokens)) {
    throw new TypeError("maxTokens must be a non-negative integer.");
  }
  if (options.countTokens && typeof options.countTokens !== "function") {
    throw new TypeError("countTokens must be a function.");
  }
  if (options.marker !== undefined && !["inline", "sidecar"].includes(options.marker)) {
    throw new TypeError('marker must be either "inline" or "sidecar".');
  }
  if (
    options.keep !== undefined &&
    !(
      typeof options.keep === "string" ||
      (Array.isArray(options.keep) && options.keep.every((path) => typeof path === "string"))
    )
  ) {
    throw new TypeError("keep must be a path or an array of paths.");
  }
  if (options.weights !== undefined) {
    if (typeof options.weights !== "object" || options.weights === null) {
      throw new TypeError("weights must be a record of positive numbers.");
    }
    for (const weight of Object.values(options.weights)) {
      if (!Number.isFinite(weight) || weight <= 0) {
        throw new TypeError("Every weight must be a finite, positive number.");
      }
    }
  }
}

function normalizeKeep(keep: string | string[] | undefined): string[] {
  if (keep === undefined) return [];
  return Array.isArray(keep) ? keep : [keep];
}

function trySerialize(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch (error) {
    if (
      error instanceof TypeError &&
      /circular|bigint/i.test(error.message)
    ) {
      return undefined;
    }
    throw error;
  }
}

function checkedTokenCount(countTokens: (text: string) => number, text: string): number {
  const tokens = countTokens(text);
  if (!Number.isFinite(tokens) || tokens < 0) {
    throw new TypeError("countTokens must return a finite, non-negative number.");
  }
  return tokens;
}
