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
console.log(result.tokens);  // Count of the serialized fitted value
console.log(result.truncated);
```

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

## API

### `fit(value, options)`

Returns `{ value, omitted, tokens, truncated }`.

| Option | Description |
| --- | --- |
| `maxTokens` | Required, finite non-negative budget. |
| `countTokens` | `(serializedText: string) => number`. Defaults to the built-in estimate. |
| `keep` | A JSON Pointer path, key name, or array of either. Matching values are not shrunk. |
| `weights` | Map of JSON Pointer patterns or key names to positive allocation weights. `*` matches any characters; more specific patterns take precedence. |
| `marker` | `"inline"` (default) inserts omission markers; `"sidecar"` leaves values type-pure and reports omissions only in `omitted`. |
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
For every report entry, `kept + dropped === total`.

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
