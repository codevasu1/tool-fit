import { fit } from "./fit.js";
import type { FitOptions, FitResult } from "./types.js";

export function wrapTool<Args extends unknown[], Result>(
  fn: (...args: Args) => Promise<Result>,
  options: FitOptions,
): (...args: Args) => Promise<FitResult<Result>>;
export function wrapTool<Args extends unknown[], Result>(
  fn: (...args: Args) => Result,
  options: FitOptions,
): (...args: Args) => FitResult<Result>;
export function wrapTool<Args extends unknown[], Result>(
  fn: (...args: Args) => Result | Promise<Result>,
  options: FitOptions,
): (...args: Args) => FitResult<Result> | Promise<FitResult<Result>> {
  return (...args: Args) => {
    const result = fn(...args);
    if (isPromiseLike(result)) {
      return Promise.resolve(result).then((value) => fit(value, options));
    }
    return fit(result, options);
  };
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return (
    (typeof value === "object" && value !== null) || typeof value === "function"
  ) && typeof (value as Promise<T>).then === "function";
}
