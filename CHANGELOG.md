# Changelog

## 0.2.0

### Added

- `report` option (`"compact"` | `"full"` | `"none"`) and `maxReportTokens` to bound the omission report. `"compact"` is the default and folds deep entries into ancestor `summary` entries.
- `FitResult.message`: the exact serialized tool message that was counted, ready to send to the model.
- `"summary"` omission kind for folded report entries.

### Changed

- `maxTokens` now budgets the whole tool message (fitted value plus omission report), and `tokens` is the count of `message` with the caller's `countTokens`.
- Default `maxIterations` raised from 8 to 12 so convergence accounts for the report.
- `fit()` throws `RangeError` when the value and minimal report cannot fit the budget.

## 0.1.0

- Initial release of the structural tool-output fitting API.
- Add token estimation, normalization, omission reporting, slicing, and tool wrapping.
