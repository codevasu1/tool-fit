import { allocate } from "./allocate.js";
import { estimateTokens } from "./estimate.js";
import { normalize } from "./normalize.js";
import { compactReport } from "./report.js";
import type { FitOptions, FitResult, JsonValue, Omission } from "./types.js";

const DEFAULT_MAX_ITERATIONS = 12;

export function fit<T>(input: T, options: FitOptions): FitResult<T> {
  validateOptions(options);

  const counter = options.countTokens ?? estimateTokens;
  const countTokens = (text: string): number => checkedTokenCount(counter, text);
  const originalText = trySerialize(input);
  if (originalText !== undefined) {
    const tokens = checkedTokenCount(countTokens, originalText);
    if (tokens <= options.maxTokens) {
      return { value: input, omitted: [], tokens, truncated: false, message: originalText };
    }
  }

  const normalized = normalize(input);
  const keepPaths = normalizeKeep(options.keep);
  const marker = options.marker ?? "inline";
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const report = options.report ?? "compact";
  const reportLimit = options.maxReportTokens ?? Math.floor(options.maxTokens / 4);
  let budget = options.maxTokens;
  let lastTokens = 0;

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const allocation = allocate(normalized, budget, {
      ...options,
      countTokens,
      marker,
      keepPaths,
    });
    const omitted =
      report === "none"
        ? []
        : report === "full"
          ? allocation.omitted
          : compactReport(allocation.omitted, reportLimit, countTokens);
    let message = buildMessage(allocation.value, omitted);
    let tokens = countTokens(message);
    let finalOmitted = omitted;
    const lastAttempt = iteration === maxIterations - 1;
    if (tokens > options.maxTokens && lastAttempt && report === "compact" && marker === "inline") {
      const bare = JSON.stringify(allocation.value);
      const bareTokens = countTokens(bare);
      if (bareTokens <= options.maxTokens) {
        message = bare;
        tokens = bareTokens;
        finalOmitted = [];
      }
    }
    lastTokens = tokens;
    if (tokens <= options.maxTokens) {
      return { value: allocation.value, omitted: finalOmitted, tokens, truncated: true, message };
    }
    const scaled = Math.floor(budget * (options.maxTokens / tokens) * 0.95);
    const reduced = budget - (tokens - options.maxTokens) - 1;
    budget = Math.max(0, Math.min(scaled, reduced));
  }

  throw new RangeError(
    `Unable to fit the tool message into ${options.maxTokens} tokens; the best attempt requires ${lastTokens}. Protected, irreducible, or report content may be too large.`,
  );
}

function buildMessage(value: JsonValue, omitted: Omission[]): string {
  return JSON.stringify(omitted.length > 0 ? { value, omitted } : value);
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
  if (options.report !== undefined && !["full", "compact", "none"].includes(options.report)) {
    throw new TypeError('report must be "full", "compact", or "none".');
  }
  if (options.report === "none" && options.marker === "sidecar") {
    throw new TypeError('report "none" cannot be combined with sidecar markers.');
  }
  if (
    options.maxReportTokens !== undefined &&
    (!Number.isInteger(options.maxReportTokens) || options.maxReportTokens < 0)
  ) {
    throw new TypeError("maxReportTokens must be a non-negative integer.");
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
