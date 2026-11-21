# Testing and verification

From the repository root, run `npm ci`, `npm test`, and `npm run typecheck`. The local suite does not require Supabase credentials. Type checking is a separate static check, not a runtime test.

| Script | Coverage |
| --- | --- |
| `tests/availability.test.mjs` | Slot generation, overlap and adjacency, invalid input, and time boundaries |
| `tests/reservation-history.test.mjs` | Reservation grouping, status, and time boundaries |
| `tests/availability-flow.test.mjs` | Mocked reservation and screen flows; migration contract inspection, not live SQL execution |
| `tests/admin-reservations.test.mjs` | Mocked Administrator reservation listing and cancellation behavior |

The Milestone 3 report records 56 passed, 0 failed, and 0 skipped for the local suite, plus a passing type check. It separately documents manual Student search, booking, and cancellation and Administrator cancellation. Mocked conflict behavior is not proof that the 100 live database conflict trials ran.

The report does not claim completion of the formal usability, performance, live concurrency, live authorization, or full viewport acceptance targets. Final-build Administrator room add/edit persistence was not recorded in the report. Any new live checks should use disposable records and test accounts, and results should be recorded separately.
