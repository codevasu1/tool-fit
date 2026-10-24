# tool-fit

Fit tool output into a token budget without throwing away the surrounding
structure. `tool-fit` is a deterministic, zero-runtime-dependency TypeScript
library. It does not summarize, compress, or bundle a tokenizer.

## Install

```sh
npm install tool-fit
```

## Quick start

```ts
import { fit } from "tool-fit";

const result = fit(apiResponse, {
  maxTokens: 800,
  keep: ["id", "status"],
});

console.log(result.value);   // Fitted value
console.log(result.omitted); // JSON Pointer paths and omission counts
console.log(result.message); // Exactly what to send to the model
console.log(result.tokens);  // countTokens(result.message), report included
console.log(result.truncated);
```

`maxTokens` budgets the **whole tool message**: the fitted value plus the
omission report, as serialized in `result.message`. Send `result.message` to
the agent and the count you measured is the count it costs. If nothing was
omitted, `message` is just the compact JSON of the value; otherwise it is
`{"value": …, "omitted": […]}`.

If the serialized input already fits, `fit()` returns the original value by
reference, with `truncated: false` and no omissions. Otherwise it normalizes
the value and returns a fitted copy. The input is never mutated.

## Example

```ts
import { fit } from "tool-fit";

const response = {
  id: "req-42",
  status: "ok",
  events: Array.from({ length: 200 }, (_, id) => ({
    id,
    message: `Event ${id}: ${"details ".repeat(20)}`,
  })),
};

const result = fit(response, {
  maxTokens: 150,
  keep: ["id", "status"],
});

// result.value retains the object keys and a head/tail sample of events.
// result.omitted reports removed array elements and nested string characters.
```

## Use cases

Each snippet below was run against the library. Exact counts depend on your
`countTokens`, so the comments describe behavior rather than numbers.

### 1. Long lists of records (GitHub issues, search results, SQL rows)

Keep identifying fields intact, guarantee a few rows survive, and let the long
text fields absorb the cuts.

```ts
const result = fit(issues, {
  maxTokens: 700,
  countTokens,
  keep: ["number", "state"], // never shrunk
  minItems: 3,               // always show at least 3 issues
});
// Head and tail issues survive, bodies are cut ("…[+469 chars]"),
// and the array ends with "…[+43 items]".
```

### 2. Application logs and plain text

Plain strings are cut on line boundaries: the first and last lines survive
with a marker between them.

```ts
const result = fit(logText, { maxTokens: 300, countTokens, report: "none" });
// "2026-01-01 INFO line 0\n…\n…[+7222 chars]…\n…last lines"
```

### 3. Scraped pages: favor the content that matters

`weights` shifts budget between siblings. Here the page body gets four times
the share of the link list. `report: "full"` returns exact paths.

```ts
const result = fit(page, {
  maxTokens: 600,
  countTokens,
  weights: { html: 4, links: 1 },
  report: "full",
});
// result.omitted:
// [{ path: "/html",  kind: "string", kept: 294, dropped: 4706, total: 5000 },
//  { path: "/links", kind: "array",  kept: 13,  dropped: 67,   total: 80 }]
```

### 4. Deeply nested configuration

`maxDepth` collapses subtrees below a depth into one-line summaries, so the
model still sees which keys exist.

```ts
const result = fit(config, { maxTokens: 150, countTokens, maxDepth: 2 });
// {"value":{"a":{"b":"{…1 keys}"},"id":1}, "omitted":[…]}
```

### 5. Let the model ask for the rest with `slice()`

Fit with exact paths, expose `slice()` as a second tool, and the model can
fetch precisely the part it was missing.

```ts
const original = await runSearch(query);
const result = fit(original, { maxTokens: 800, countTokens, report: "full" });
// result.omitted contains e.g. { path: "/items", kind: "array", kept: 3, total: 1201, … }

// Second tool the model can call:
function readMore(pointer: string, offset: number, limit: number) {
  return slice(original, pointer, { offset, limit });
}
readMore("/items", 3, 20); // items 3..22 of the original
```

Keep `original` (or re-run the tool) on your side; `slice()` addresses it with
the same JSON Pointer paths that `omitted` reports. In the default `"compact"`
mode, deep entries are folded into `summary` paths, so use `report: "full"`
when the model needs exact paths to request.

### 6. Wrap a tool once

```ts
const search = wrapTool(
  async (query: string) => ({ query, results: await runSearch(query) }),
  { maxTokens: 500, countTokens },
);

const { message, truncated, tokens } = await search("tool-fit");
// Send `message` as the tool result. `tokens` is its exact cost.
```

### 7. Plug in a real tokenizer for a hard guarantee

With the default estimator the budget is a close target. A real counter makes
it a limit on the full message:

```ts
import { encodingForModel } from "js-tiktoken";

const enc = encodingForModel("gpt-4o");
const countTokens = (text: string) => enc.encode(text).length;

const result = fit(toolResult, { maxTokens: 800, countTokens });
// countTokens(result.message) <= 800, or fit() throws a RangeError.
```

### 8. Keep the data type-pure with sidecar markers

`marker: "sidecar"` never inserts marker strings into arrays or objects, so
downstream code can rely on the shape. Omissions are reported only in
`omitted`, so keep `report` at `"compact"` or `"full"`. Give it a budget large
enough for the data; at very small budgets whole arrays collapse to empty ones.

```ts
const result = fit(rows, { maxTokens: 400, countTokens, marker: "sidecar", report: "full" });
// result.value.rows is still a plain array of rows; result.omitted says what was cut.
```

### 9. Handle budgets that are too small

If the value and its minimal report cannot fit, `fit()` throws instead of
silently overspending.

```ts
try {
  const result = fit(hugeResult, { maxTokens: 5, countTokens });
} catch (error) {
  if (error instanceof RangeError) {
    // Raise the budget, drop `keep` entries, or return a plain error message.
  }
}
```

## API

### `fit(value, options)`

Returns `{ value, omitted, tokens, truncated, message }`.

| Option | Description |
| --- | --- |
| `maxTokens` | Required, finite non-negative budget. |
| `countTokens` | `(serializedText: string) => number`. Defaults to the built-in estimate. |
| `keep` | A JSON Pointer path, key name, or array of either. Matching values are not shrunk. |
| `weights` | Map of JSON Pointer patterns or key names to positive allocation weights. `*` matches any characters; more specific patterns take precedence. |
| `marker` | `"inline"` (default) inserts omission markers; `"sidecar"` leaves values type-pure and reports omissions only in `omitted`. |
| `report` | `"compact"` (default) folds the report into ancestor `summary` entries until it fits `maxReportTokens`; `"full"` keeps every entry (and charges for it); `"none"` drops `omitted` (inline markers still show cuts; not allowed with `"sidecar"`). |
| `maxReportTokens` | Token cap for the compact report. Defaults to a quarter of `maxTokens`. |
| `minItems` | Minimum number of original array items to retain when the budget permits. |
| `minChars` | Minimum number of Unicode code points to retain from a string when the budget permits. |
| `maxDepth` | Collapse containers at or beyond this depth when they need shrinking. Root depth is zero. |
| `maxIterations` | Maximum budget-adjustment attempts; defaults to 8. |

Keep paths may be supplied as JSON Pointers (for example, `"/meta/id"`); a
plain name (for example, `"id"`) keeps every value with that key name. Keeping
a value that alone exceeds the budget can make fitting impossible. In that
case, `fit()` throws a `RangeError` rather than silently violating the budget.
Irreducible primitive values or minimum floors that cannot fit can likewise
make a requested budget impossible.

### Omission reports and markers

Paths use JSON Pointer escaping (`~` becomes `~0`, `/` becomes `~1`). String
counts are Unicode code points; array and object counts are items and keys.
For every non-summary report entry, `kept + dropped === total`. A `summary`
entry stands for several omissions folded beneath its path: `dropped` (and
`total`) is the number of folded omissions and `kept` is 0. Use `report: "full"`
when you need every exact path. With `report: "compact"` and inline markers, if
even the smallest report cannot fit on the final attempt, the report is dropped
and the inline markers alone describe the cuts.

Inline markers are:

- String: `The first part…[+4210 chars]`
- Array: retained items followed by `…[+1198 items]`
- Collapsed object: `"{…12 keys}"`
- Collapsed array: `"[…40 items]"`

In `"sidecar"` mode, arrays and objects remain arrays and objects; omissions
are conveyed through the report instead of marker values. Objects normally
retain every key, shrinking their values independently. If even their minimal
structure cannot fit, an object can collapse to an empty object in sidecar
mode. A depth-collapsed value is represented by its inline summary marker in
inline mode.

The allocator distributes available room across siblings in proportion to
their remaining needs and configured weights. Arrays retain a head-and-tail
sample; strings retain a balanced head and tail, respecting line boundaries in
multiline text. If a subtree's minimum representation cannot fit, it is
collapsed where possible. The final serialized value is recounted and the
allocation is retried to account for serialization overhead.

### Token counting honesty

The built-in estimator is a small character-based estimate that uses different
ratios for JSON-heavy text and prose. It is intended as a close target, not a
guarantee for a specific model tokenizer. Supply the tokenizer used by your
model when strict enforcement matters:

```ts
import { encodingForModel } from "js-tiktoken";
import { fit } from "tool-fit";

const encoding = encodingForModel("gpt-4o");
const result = fit(toolResult, {
  maxTokens: 800,
  countTokens: (text) => encoding.encode(text).length,
});
```

`js-tiktoken` is an example optional integration and is not a dependency of
`tool-fit`. The output count includes the compact JSON serialization of the
fitted value. With a real counter, fitting is enforced when a valid result is
possible; protected or irreducible input can make that impossible and causes
a `RangeError`.

### `slice(original, pointer, { offset, limit })`

Retrieve a requested range from an array or string at a JSON Pointer path. This
is useful as a follow-up tool when a model needs more of an omitted result:

```ts
import { slice } from "tool-fit";

const moreEvents = slice(originalResponse, "/events", {
  offset: 40,
  limit: 20,
});
```

The pointer must resolve to an array or string. Invalid pointers and ranges
throw rather than returning a misleading empty result.

### `wrapTool(fn, options)`

Wrap a synchronous or asynchronous tool function. The wrapper preserves its
arguments and returns the complete `FitResult`, so callers retain access to the
omission report:

```ts
import { wrapTool } from "tool-fit";

const fittedSearch = wrapTool(search, { maxTokens: 800 });
const result = await fittedSearch("tool-fit");
```

### Normalization

Values that require normalization are converted before shrinking: `Date` to an
ISO string, `BigInt` to a decimal string, `Map` to entry pairs, and `Set` to an
array. Undefined object properties and array values are omitted; circular
references become `"[Circular]"`. Shared (non-circular) objects are converted
independently. Invalid dates become `"Invalid Date"` and non-finite numbers
become `null`.

## Development

```sh
npm install
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

The test suite includes property-based checks using the development-only
`fast-check` dependency. ESM, CommonJS, and declaration files are built into
`dist/`; runtime dependencies are not bundled or required.
