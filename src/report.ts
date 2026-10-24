import type { Omission } from "./types.js";

function depthOf(path: string): number {
  return path === "" ? 0 : path.split("/").length - 1;
}

function foldBelow(omitted: Omission[], depth: number): Omission[] {
  const result: Omission[] = [];
  const groups = new Map<string, Omission>();
  for (const entry of omitted) {
    if (depthOf(entry.path) <= depth) {
      result.push(entry);
      continue;
    }
    const prefix = entry.path.split("/").slice(0, depth + 1).join("/");
    const group = groups.get(prefix);
    if (group) {
      group.dropped += 1;
      group.total += 1;
    } else {
      const summary: Omission = {
        path: prefix,
        kind: "summary",
        kept: 0,
        dropped: 1,
        total: 1,
      };
      groups.set(prefix, summary);
      result.push(summary);
    }
  }
  return result;
}

// Summary entries count the omissions folded beneath their path.
export function compactReport(
  omitted: Omission[],
  limit: number,
  countTokens: (text: string) => number,
): Omission[] {
  if (omitted.length === 0 || countTokens(JSON.stringify(omitted)) <= limit) {
    return omitted;
  }
  let current = omitted;
  const deepest = Math.max(...omitted.map((entry) => depthOf(entry.path)));
  for (let depth = deepest - 1; depth >= 0; depth -= 1) {
    current = foldBelow(current, depth);
    if (countTokens(JSON.stringify(current)) <= limit) break;
  }
  return current;
}
