import { arrayMarker, objectMarker, pointerSegment, stringMarker } from "./markers.js";
import type { FitOptions, JsonValue, Omission } from "./types.js";

export interface AllocationOptions extends FitOptions {
  countTokens: (text: string) => number;
  marker: "inline" | "sidecar";
  keepPaths: string[];
}

interface AllocationState {
  options: AllocationOptions;
  omissions: Omission[];
}

export function allocate(
  value: JsonValue,
  budget: number,
  options: AllocationOptions,
): { value: JsonValue; omitted: Omission[] } {
  const state: AllocationState = { options, omissions: [] };
  const result = shrink(value, budget, "", 0, state);
  return { value: result, omitted: state.omissions };
}

function shrink(
  value: JsonValue,
  budget: number,
  path: string,
  depth: number,
  state: AllocationState,
): JsonValue {
  const { countTokens, keepPaths, marker, maxDepth } = state.options;
  if (isKept(path, keepPaths)) return value;
  if (countTokens(serialize(value)) <= budget) return value;

  if (maxDepth !== undefined && depth >= maxDepth && isContainer(value)) {
    return collapse(value, path, state);
  }

  if (typeof value === "string") return shrinkString(value, budget, path, state);

  if (Array.isArray(value)) return shrinkArray(value, budget, path, depth, state);

  if (isObject(value)) return shrinkObject(value, budget, path, depth, state);

  return value;
}

function shrinkString(
  value: string,
  budget: number,
  path: string,
  state: AllocationState,
): string {
  const characters = Array.from(value);
  const total = characters.length;
  if (total === 0) return value;
  const { countTokens, marker } = state.options;
  const maxKept = Math.max(0, total - 1);

  const makeCandidate = (kept: number): { text: string; kept: number } => {
    let head = characters.slice(0, Math.ceil(kept / 2)).join("");
    let tail = characters.slice(total - Math.floor(kept / 2)).join("");
    if (value.includes("\n")) {
      const headBoundary = head.lastIndexOf("\n");
      const tailBoundary = tail.indexOf("\n");
      if (headBoundary >= 0) head = head.slice(0, headBoundary + 1);
      if (tailBoundary >= 0) tail = tail.slice(tailBoundary);
    }
    const keptCharacters = Array.from(head).length + Array.from(tail).length;
    const dropped = total - keptCharacters;
    const visibleMarker = marker === "inline" ? stringMarker(dropped) : "";
    return { text: `${head}${visibleMarker}${tail}`, kept: keptCharacters };
  };

  const kept = largestFitting(
    0,
    maxKept,
    (count) => countTokens(serialize(makeCandidate(count).text)) <= budget,
  );
  const candidate = makeCandidate(kept);
  if (candidate.kept < Math.min(state.options.minChars ?? 0, total)) {
    throw new RangeError(`Token budget is too small to preserve minChars at "${path || "/"}".`);
  }
  state.omissions.push({
    path: path || "",
    kind: "string",
    kept: candidate.kept,
    dropped: total - candidate.kept,
    total,
  });
  return candidate.text;
}

function shrinkArray(
  value: JsonValue[],
  budget: number,
  path: string,
  depth: number,
  state: AllocationState,
): JsonValue[] {
  const total = value.length;
  let low = 0;
  let high = total;
  let keptCount = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const indices = alternatingIndices(total, middle);
    const minimumCost = countArrayMinimum(value, indices, total - indices.length, state);
    if (minimumCost <= budget) {
      keptCount = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  const minimumItems = Math.min(state.options.minItems ?? 0, total);
  if (keptCount < minimumItems) {
    throw new RangeError(`Token budget is too small to preserve minItems at "${path || "/"}".`);
  }

  const indices = alternatingIndices(total, keptCount);
  const dropped = total - indices.length;
  const baseValues = indices.map((index) =>
    minimumValue(value[index]!, state.options),
  );
  const baseArray = withArrayMarker(baseValues, dropped, state.options.marker);
  const baseCost = state.options.countTokens(serialize(baseArray));
  const childBudgets = distributeBudgets(
    indices.map((index) => state.options.countTokens(serialize(value[index]!))),
    baseValues.map((entry) => state.options.countTokens(serialize(entry))),
    Math.max(0, budget - baseCost),
    indices.map((index) => weightFor(`${path}/${index}`, state.options.weights)),
  );
  const output = indices.map((index, position) =>
    shrink(
      value[index]!,
      childBudgets[position]!,
      `${path}/${index}`,
      depth + 1,
      state,
    ),
  );

  if (dropped > 0) {
    if (state.options.marker === "inline") output.push(arrayMarker(dropped));
    state.omissions.push({
      path: path || "",
      kind: "array",
      kept: indices.length,
      dropped,
      total,
    });
  }
  return output;
}

function shrinkObject(
  value: { [key: string]: JsonValue },
  budget: number,
  path: string,
  depth: number,
  state: AllocationState,
): JsonValue {
  const keys = Object.keys(value);
  const minimum = minimumValue(value, state.options);
  if (state.options.countTokens(serialize(minimum)) > budget) {
    if (keys.length === 0) return value;
    return collapse(value, path, state);
  }

  const baseValues = keys.map((key) => minimumValue(value[key]!, state.options));
  const baseObject = Object.fromEntries(keys.map((key, i) => [key, baseValues[i]]));
  const baseCost = state.options.countTokens(serialize(baseObject));
  const budgets = distributeBudgets(
    keys.map((key) => state.options.countTokens(serialize(value[key]!))),
    baseValues.map((entry) => state.options.countTokens(serialize(entry))),
    Math.max(0, budget - baseCost),
    keys.map((key) => weightFor(`${path}/${pointerSegment(key)}`, state.options.weights)),
  );

  const output: { [key: string]: JsonValue } = {};
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const childPath = `${path}/${pointerSegment(key)}`;
    Object.defineProperty(output, key, {
      value: shrink(value[key]!, budgets[index]!, childPath, depth + 1, state),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return output;
}

function collapse(
  value: JsonValue,
  path: string,
  state: AllocationState,
): JsonValue {
  if (Array.isArray(value)) {
    const total = value.length;
    state.omissions.push({
      path: path || "",
      kind: "array",
      kept: 0,
      dropped: total,
      total,
    });
    return state.options.marker === "inline" ? arrayMarker(total) : [];
  }

  if (isObject(value)) {
    const total = Object.keys(value).length;
    state.omissions.push({
      path: path || "",
      kind: "object",
      kept: 0,
      dropped: total,
      total,
    });
    return state.options.marker === "inline"
      ? objectMarker(total)
      : {};
  }

  return "";
}

function countArrayMinimum(
  value: JsonValue[],
  indices: number[],
  dropped: number,
  state: AllocationState,
): number {
  const items = indices.map((index) => minimumValue(value[index]!, state.options));
  return state.options.countTokens(
    serialize(withArrayMarker(items, dropped, state.options.marker)),
  );
}

function withArrayMarker(
  items: JsonValue[],
  dropped: number,
  marker: "inline" | "sidecar",
): JsonValue[] {
  return dropped > 0 && marker === "inline"
    ? [...items, arrayMarker(dropped)]
    : items;
}

function minimumValue(value: JsonValue, options: AllocationOptions): JsonValue {
  let minimum: JsonValue;
  if (typeof value === "string") {
    const characters = Array.from(value);
    const kept = Math.min(options.minChars ?? 0, characters.length);
    const dropped = characters.length - kept;
    const head = characters.slice(0, kept).join("");
    minimum = dropped > 0 && options.marker === "inline"
      ? `${head}${stringMarker(dropped)}`
      : head;
  } else if (Array.isArray(value)) {
    const keptIndices = alternatingIndices(
      value.length,
      Math.min(options.minItems ?? 0, value.length),
    );
    const items = keptIndices.map((index) => minimumValue(value[index]!, options));
    minimum = withArrayMarker(items, value.length - keptIndices.length, options.marker);
  } else if (isObject(value)) {
    minimum = Object.fromEntries(
      Object.keys(value).map((key) => [key, minimumValue(value[key]!, options)]),
    );
  } else {
    return value;
  }

  return options.countTokens(serialize(minimum)) < options.countTokens(serialize(value))
    ? minimum
    : value;
}

function distributeBudgets(
  costs: number[],
  minima: number[],
  extraBudget: number,
  weights: number[],
): number[] {
  const allocations = minima.slice();
  let remaining = Math.max(0, extraBudget);
  let active = costs
    .map((cost, index) => ({ index, need: Math.max(0, cost - minima[index]!), weight: weights[index]! }))
    .filter((entry) => entry.need > 0);

  while (remaining > 0 && active.length > 0) {
    const totalWeight = active.reduce((sum, entry) => sum + entry.weight, 0);
    let spent = 0;
    const next: typeof active = [];
    for (const entry of active) {
      const share = (remaining * entry.weight) / totalWeight;
      const amount = Math.min(entry.need, Math.floor(share));
      allocations[entry.index] = allocations[entry.index]! + amount;
      entry.need -= amount;
      spent += amount;
      if (entry.need > 0) next.push(entry);
    }
    if (spent === 0) {
      const entry = active[0]!;
      allocations[entry.index] = allocations[entry.index]! + 1;
      entry.need -= 1;
      spent = 1;
      if (entry.need === 0) active.shift();
    } else {
      active = next;
    }
    remaining -= spent;
  }
  return allocations;
}

function largestFitting(
  minimum: number,
  maximum: number,
  fits: (candidate: number) => boolean,
): number {
  let low = minimum;
  let high = maximum;
  let result = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (fits(middle)) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result < 0 ? minimum : result;
}

function alternatingIndices(total: number, count: number): number[] {
  const headCount = Math.ceil(count / 2);
  const tailCount = Math.floor(count / 2);
  const head = Array.from({ length: headCount }, (_, index) => index);
  const tail = Array.from({ length: tailCount }, (_, index) => total - tailCount + index);
  return [...head, ...tail];
}

function isKept(path: string, keepPaths: string[]): boolean {
  return keepPaths.some((keep) => {
    if (keep === path || keep === "") return true;
    if (keep.startsWith("/")) return path === keep || path.startsWith(`${keep}/`);
    const lastSegment = path
      .slice(path.lastIndexOf("/") + 1)
      .replace(/~1/g, "/")
      .replace(/~0/g, "~");
    return lastSegment === keep;
  });
}

function weightFor(path: string, weights: Record<string, number> | undefined): number {
  if (!weights) return 1;
  let selectedWeight = 1;
  let selectedLength = -1;
  for (const [pattern, weight] of Object.entries(weights)) {
    if (!Number.isFinite(weight) || weight <= 0) continue;
    if (matchesPattern(path, pattern) && pattern.length > selectedLength) {
      selectedWeight = weight;
      selectedLength = pattern.length;
    }
  }
  return selectedWeight;
}

function matchesPattern(path: string, pattern: string): boolean {
  const target = pattern.startsWith("/")
    ? path
    : path.slice(path.lastIndexOf("/") + 1);
  if (pattern === target) return true;
  if (!pattern.includes("*")) return false;
  const expression = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${expression}$`).test(target);
}

function serialize(value: JsonValue): string {
  return JSON.stringify(value);
}

function isObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isContainer(value: JsonValue): value is JsonValue[] | { [key: string]: JsonValue } {
  return Array.isArray(value) || isObject(value);
}
