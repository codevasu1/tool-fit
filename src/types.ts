export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type OmissionKind = "string" | "array" | "object" | "summary";

export type ReportMode = "full" | "compact" | "none";

export interface Omission {
  path: string;
  kind: OmissionKind;
  kept: number;
  dropped: number;
  total: number;
}

export interface FitResult<T = unknown> {
  value: T | JsonValue;
  omitted: Omission[];
  tokens: number;
  truncated: boolean;
  message: string;
}

export interface FitOptions {
  maxTokens: number;
  countTokens?: (text: string) => number;
  keep?: string | string[];
  weights?: Record<string, number>;
  marker?: "inline" | "sidecar";
  report?: ReportMode;
  maxReportTokens?: number;
  minItems?: number;
  minChars?: number;
  maxDepth?: number;
  maxIterations?: number;
}

export interface SliceOptions {
  offset: number;
  limit: number;
}

export type NormalizedValue = JsonValue;
