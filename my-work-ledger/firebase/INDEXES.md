# Composite indexes

`firestore.indexes.json` carries no comments because the Firebase CLI validates it
against a strict schema and rejects unknown keys. What each index is for:

- `transactions` (collection): voidedAt ascending, sortKey descending
  The default transaction list: newest first, voided entries excluded.
- `transactions` (collection): voidedAt ascending, kind ascending, sortKey descending
  Filtering the list to one kind, e.g. just the expenses.
- `transactions` (collection): voidedAt ascending, periodKey ascending, sortKey descending
  One month of a shop's ledger, which is what the engine loads.
- `transactions` (collection group): uid ascending, voidedAt ascending, periodKey ascending
  The cross-shop dashboard: every shop's entries for one period, in one read.
- `settlements` (collection): shopId ascending, periodEnd descending
  Settlement history for a shop, most recent statement first.
