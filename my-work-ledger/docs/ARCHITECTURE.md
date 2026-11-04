# My Work Ledger — Phase 0: architecture and implementation plan

## Context

Saheer works at more than one shop. Each shop owes him a monthly salary plus allowances, and
he regularly pays shop expenses out of his own pocket. Money comes back as advances, salary
payments and reimbursements, sometimes with deductions. Today this lives in memory and
scattered notes, which means forgotten entries, disagreements about what is owed, and no
record of what was settled when.

**My Work Ledger** is a personal multi-shop ledger that answers one question reliably at any
moment: *how much does each shop owe me right now, and why?* It must be usable daily on a
phone, work offline, survive a reinstall, and produce a statement that can be handed to a
shop owner.

This is a financial record. Correctness beats everything else — a wrong balance is worse than
a missing animation. The plan is deliberately conservative about money and liberal about
polish.

---

## Phase 0 findings: what the repository already settles

`/home/user/dev` is a static multi-project site on Vercel. Each top-level folder is served at
`/<folder>/`; there is no root build step. `transferbox/` is the only React project and it
sets the conventions this project follows rather than reinvents:

| Concern | Existing convention | Reuse |
| --- | --- | --- |
| Build/publish | source in `app/`, `vite build` → `app/dist`, then `app/scripts/publish.mjs` copies dist up into the served folder; built output is committed | Copy pattern and script |
| Toolchain | Vite 8, React 19, TypeScript strict (`noUncheckedIndexedAccess`), alias `@/* → src/*` | Same |
| Styling | Tailwind v4 via `@tailwindcss/vite`, no config file; CSS custom properties + `@theme inline`; dark mode via `prefers-color-scheme` plus a `data-theme` attribute, so no `dark:` variants | Same mechanism, new palette |
| Tests | Vitest, `environment: 'node'`, `src/**/*.test.ts`, pure functions with injected `now` | Same — ideal for the engine |
| Firebase | lazy init from `VITE_FIREBASE_*` behind `isCloudConfigured()`; web config is public, rules are the boundary | Same shape, extended to Auth + Firestore |
| Rules | default-deny, per-path validation, field whitelists, size caps, bounded timestamps | Same strictness, now keyed on `auth.uid` |
| Android | CI builds a throwaway Capacitor project, publishes a GitHub Release asset | Adapt — but this app needs a **committed** Capacitor project (see risks) |

**New ground:** no Firebase Auth, no Firestore, no PDF library, no date library and no tested
financial code exists anywhere in the repo. Closest prior art is
`freelance-rate-calculator/assets/engine.js` — vanilla, untested, but the right shape: all
maths in one pure module, no DOM.

Nothing existing is modified. This is a new folder, `my-work-ledger/`.

---

## Decisions taken (confirmed with the user)

1. **Salary accrual — app proposes, user confirms.** On the salary date a pending card appears
   ("₹18,000 salary for November"); one tap writes it. Nothing is written silently.
2. **Shop expenses are reimbursable by default**, switchable per entry to non-reimbursable
   (recorded as a personal cost, excluded from the shop balance).
3. **Calendar-day pro-rata** for partial months.
4. **TypeScript**, matching the repo — paise vs rupees and the nine transaction kinds become
   compile-time errors instead of runtime bugs.

### Versions (peer-checked, mutually compatible)

```
react/react-dom 19.3.1 · vite 8.3.5 · typescript 5.9 · vitest 5.1.0
tailwindcss 4.3.4 + @tailwindcss/vite · firebase 13.2.0 (Auth + Firestore)
jspdf 4.2.1 + jspdf-autotable 5.0.9 · lucide-react 1.67.0 · framer-motion 14.9.0
@capacitor/core|android 8.6.0 · @capacitor/local-notifications 8.3.1
```

`framer-motion@14` declares an odd `remix` peer; if install warns, `motion` is the drop-in
replacement from the same team with the same API.

---

## Money rules (the part that must be right)

### Representation

- **All money is an integer number of paise.** A `Paise` branded type; no floats anywhere.
  Input is parsed from the string the user typed (`"1200.50"` → `120050`), never
  `parseFloat(x) * 100`.
- **`transactionDate` is a calendar date string `YYYY-MM-DD`,** not a timestamp. A payment on
  4 November stays 4 November in every timezone, on a phone that travels, and after a
  Capacitor rebuild. `createdAt`/`updatedAt` are Firestore `serverTimestamp()`.
- A derived `periodKey` (`YYYY-MM`) is stored alongside, so month queries need no range scan.

### Sign convention

Balance is stated from the employee's side: **positive = the shop owes you.**

| Transaction kind | Effect on balance | Note |
| --- | --- | --- |
| `salary_earned` | **+** | accrual, not cash |
| `allowance_earned` | **+** | food / daily / weekly / monthly |
| `other_income_earned` | **+** | overtime, bonus, custom |
| `expense_paid` *(reimbursable)* | **+** | you funded the shop; it owes you |
| `expense_paid` *(non-reimbursable)* | **0** | recorded as a personal cost only |
| `advance_received` | **−** | money received — **never an earning** |
| `salary_payment_received` | **−** | money received |
| `reimbursement_received` | **−** | money received against expenses |
| `deduction` | **−** | shop reduces what it owes; no cash moves |
| `adjustment` | **±** | signed manual correction, reason required |

```
closing = opening
        + earnings (salary + allowance + other income)
        + reimbursable expenses
        − money received (advance + salary payment + reimbursement)
        − deductions
        ± adjustments
```

### How double counting is prevented

- An expense is recorded **once** as `expense_paid` (+). The money returning is recorded
  **once** as `reimbursement_received` (−). Net zero.
- *"Adjusted against salary" is not a third mechanic* — it is the same two entries where the
  money arrives inside the salary payment. ₹10,000 salary + ₹200 expense paid as ₹10,200 is
  one `salary_payment_received` of ₹10,200. The UI will say this plainly instead of offering a
  confusing third option, because a third option is exactly how expenses get counted twice.
- The real trap is logging an expense **and** a deduction for the same money.
  `reimbursement_received` may link `settlesExpenseIds[]`, and the form warns when a linked
  expense is already fully cleared.

### Negative balances

Normal after an advance. Displayed as **"You owe Blue Mart ₹450"** in the amber/debit
treatment — never as a bare `−₹450` inside a green "owed to you" card.

### Rounding

Division happens only in pro-rata. `slice = floor(monthly × days ÷ daysInMonth)` for every
slice but the last; the last slice takes `monthly − Σ(previous)`. Slices therefore always sum
to the exact monthly figure, with no drifting paise.

### Module boundary

| Module | Owns | Knows nothing about |
| --- | --- | --- |
| `lib/money.ts` | `Paise` type, parse, format, add/sub | React, Firestore |
| `lib/dates.ts` | `YYYY-MM-DD` helpers, periods, month-end clamping | React, Firestore |
| `features/ledger/engine.ts` | `{opening, transactions, period} → {totals, closing}` | React, Firestore, `Date.now()` (today is injected) |
| `features/ledger/accrual.ts` | `{configs, period, existingKeys} → proposed accruals` | React, Firestore |
| `features/settlements/settle.ts` | snapshot builder, reconciliation detection | React, Firestore |

React components render computed values. **No arithmetic in JSX.**

---

## Firestore schema

```
users/{uid}                                   profile: displayName, currency, createdAt
  shops/{shopId}                              name, description, joiningDate, salaryPayDay,
                                              openingBalance (paise), openingBalanceAsOf,
                                              status: active|archived, createdAt, updatedAt
    incomeConfigs/{configId}                  kind, amount (paise), frequency, effectiveFrom,
                                              effectiveTo?, description, active
    transactions/{txnId}                      see below
    settlements/{settlementId}                immutable snapshot, see below
  reminders/{reminderId}                      type, weekday?, dayOfMonth?, time, title, body,
                                              enabled, lastFiredAt, nextFireAt
  auditLogs/{logId}                           at, action, entity, entityId, before, after
```

**transaction**

```ts
{
  id, shopId, kind,                     // the nine kinds above
  amount: Paise,                        // always positive; `kind` carries the sign
  direction: 'credit' | 'debit',        // denormalised for queries, derived from kind
  reimbursable?: boolean,               // expense_paid only
  category, description,
  transactionDate: 'YYYY-MM-DD',
  periodKey: 'YYYY-MM',
  accrualKey?: string,                  // configId:periodKey, accruals only
  settlesExpenseIds?: string[],
  affectsSealedSettlement?: string,     // set when backdated into a sealed period
  attachmentRef?: string,
  clientRequestId: string,
  createdAt, updatedAt,                 // serverTimestamp
  voidedAt?, voidReason?                // soft delete
}
```

**Duplicate prevention is structural, not hopeful:**
- The client generates the document ID and writes with `setDoc`. A retried write lands on the
  **same document** instead of creating a second one.
- Accruals go further: the ID is deterministic, `acc_{configId}_{periodKey}`. Two salary
  entries for one month are not merely discouraged, they are the same document.

**Soft deletion:** queries filter `voidedAt == null`. A transaction inside a sealed settlement
*cannot* be voided — it is corrected by a counter `adjustment` in the current open period, so
sealed history is never rewritten. Every mutation writes an audit log entry.

**Composite indexes** (declared in `firestore.indexes.json`):

| Collection | Fields |
| --- | --- |
| transactions | `voidedAt ASC, transactionDate DESC` |
| transactions | `voidedAt ASC, kind ASC, transactionDate DESC` |
| transactions | `voidedAt ASC, periodKey ASC, transactionDate DESC` |
| settlements | `periodEnd DESC` |

**Security rules:** everything under `users/{uid}/**` requires `request.auth.uid == uid`.
Per-field validation mirrors the existing repo style: enumerated `kind`, `amount` an integer
within bounds, `transactionDate` matching `^\d{4}-\d{2}-\d{2}$`, no unknown fields, sealed
settlements immutable (`allow update: if false` once `sealedAt` exists).

---

## Salary accrual without duplicates

Income configs are **effective-dated**: `effectiveFrom`, optional `effectiveTo`. For a given
period the engine slices the period by config coverage and pro-rates each slice by calendar
days, with the last-slice remainder rule above.

- The app computes *proposed* accruals for the period, excludes any whose deterministic ID
  already exists, and shows the rest as pending cards. One tap writes them.
- **Editing a config never rewrites an existing accrual.** It offers "recalculate November?",
  which writes a signed `adjustment` for the difference and leaves the original entry and its
  audit trail intact.

---

## Settlement and reconciliation

A settlement is a **statement, not a money movement** — the single most important separation
here. Cash handed over at settlement time is an ordinary `salary_payment_received`
transaction. Conflating the two double-counts every settlement.

Snapshot stores: `periodStart`, `periodEnd`, `settlementDate`, `openingBalance`, totals per
category, `closingBalance`, `includedTransactionIds`, `sealedAt`, `notes`, and
`status: sealed | needs_reconciliation`.

- **Carry-forward:** the next period opens at the previous snapshot's `closingBalance`. Partial
  settlement is the normal case; the balance is never forced to zero.
- **Backdated entry into a sealed period:** the transaction keeps its true date, is tagged
  `affectsSealedSettlement`, flips that settlement to `needs_reconciliation`, and is counted
  by the engine in the **current open period** as a prior-period adjustment. The sealed
  snapshot is never rewritten; the settlement screen lists what arrived after sealing.
- A transaction dated before the shop's `openingBalanceAsOf` is rejected, with an offer to
  move the opening date instead.

---

## Risks, stated honestly

1. **Android reminders are best-effort, not guaranteed.** Android 13+ needs runtime
   `POST_NOTIFICATIONS`; Android 12+ needs `SCHEDULE_EXACT_ALARM` for exact timing; Doze
   delays inexact alarms; Xiaomi/Oppo/Vivo/Samsung kill background apps aggressively; alarms
   are lost on reboot unless rescheduled via `RECEIVE_BOOT_COMPLETED`. Plan: schedule locally
   (not FCM), reschedule on every app open and on boot, clamp monthly dates (29/30/31 → last
   day of a short month), and ship a Reminder diagnostics screen that shows permission state
   and offers the battery-optimisation settings intent. The docs will say plainly that a
   reminder can be delayed on some phones.
2. **Capacitor project must be committed** for this app, unlike the throwaway CI pattern used
   for Food Money: local notifications need a plugin, a manifest permission and a channel.
   `my-work-ledger/app/android/` goes in the repo.
3. **Public signup on a personal app.** Rules isolate per `uid`, so there is no data exposure,
   but anyone could create an account in the project. Mitigation: disable self-signup in the
   Auth console once the account exists, and enable App Check. Flagged, not silently ignored.
4. **Firestore retries** could duplicate writes — solved structurally by client-generated and
   deterministic document IDs.
5. **Committed build output** must be rebuilt before each commit, as in `transferbox`.
6. **jsPDF is ~400 KB** — the report module is lazy-loaded so it never slows the dashboard.
7. **Firebase project choice — settled at Phase 1.** The project is **`my-web-b35e3`**,
   dedicated to this app, which is why `firebase/firestore.rules` can be a strict default-deny
   ruleset: there is nothing else in the project for a deploy to clobber. Still outstanding and
   needing the console, not code: enable Email/Password sign-in, create the Firestore database,
   then disable self-signup (risk 3) and restrict the API key by referrer.

---

## Platform constraints found during design review

These are SDK behaviours that quietly break the obvious implementation. Each one is already
reflected in `src/types/models.ts` or in the rules.

1. **`runTransaction` does not work offline.** It needs a server round trip, so it fails
   outright with no connection. Therefore the ordinary add-an-entry path must never use one —
   it is a plain `setDoc` with a client-minted id. Only *sealing* needs transactional
   behaviour (allocating `statementNo`, capping a reimbursement against expenses), and sealing
   must detect being offline and refuse with a clear message rather than appear to work.
2. **`serverTimestamp()` reads back as `null` while the write is pending.** An offline entry
   therefore has no `createdAt` for minutes or hours. Sorting or formatting by `createdAt`
   would make an entry jump position, or render as "—", until it syncs. Hence
   **`sortKey = transactionDate#clientCreatedAtMs#txnId`**, which is final the moment the write
   is queued, and `clientCreatedAtMs` alongside it.
3. **A batch is capped at 500 operations.** Stamping `settlementId` onto a long period's
   entries can exceed that. Hence **`sealState: 'stamping' | 'sealed'`** on the settlement and
   chunked, resumable batches of 400: a seal interrupted halfway is resumable rather than
   half-applied, and the rules only let `stamping` advance to `sealed`.
4. **jsPDF's built-in Helvetica has no U+20B9 (₹).** The glyph renders as a blank or a box. The
   report must either embed a subsetted font via `addFileToVFS`/`addFont` or print `Rs.`
   Decided at Phase 4; the amount formatter already takes a `symbol: false` option for it.
5. **`signInWithPopup` does not work in a Capacitor WebView.** Not a problem now, since this
   app uses email and password, but any future federated sign-in needs
   `@capacitor-firebase/authentication` for the native path (Phase 6).
6. **`fundedFrom: 'own' | 'shopFloat'` on expenses.** Only `'own'` creates a receivable. An
   expense paid out of the shop's own petty cash is a record of spending, not of the shop owing
   you; without this field a float silently inflates the balance.
7. **`recognitionDate` separate from `transactionDate`.** An entry backdated into a sealed
   period keeps its true `transactionDate` for the record, but gets
   `recognitionDate = sealedThroughDate + 1 day`, `isPriorPeriodAdjustment: true` and
   `adjustsSettlementId`. `periodKey` is derived from `recognitionDate`, so period queries pick
   it up in the open period while the sealed statement stays untouched.
8. **A denormalised `uid` on every transaction**, so the cross-shop dashboard can run one
   collection-group query instead of N per-shop listeners. The rules assert
   `incoming().uid == uid`, so the field cannot be forged into somebody else's dashboard — and
   the collection-group rule only permits a query that filters on the caller's own uid.
9. **Clock skew.** Posting an accrual depends on "has the salary date passed". A device whose
   clock is weeks out would mint entries for months that have not happened, so
   `clockSkewMs()`/`MAX_CLOCK_SKEW_MS` in `lib/clock.ts` compare against a server timestamp
   and refuse to post beyond a day of drift.

**Not adopted:** the review suggested Google-only sign-in to avoid password handling. The brief
specifies email and password, so that stands; the password floor is length-based (10 characters)
rather than a composition rule, which pushes people towards `Password1!`.

---

## Phase plan

Each phase ends with a summary, changed files, actual test results, known bugs and a commit.
No phase starts while the previous one has a failing test.

| Phase | Deliverable | Exit test |
| --- | --- | --- |
| **1 Foundation** | folder + Vite/TS/Tailwind scaffold matching `transferbox`, design tokens, app shell with bottom nav (mobile) / sidebar (desktop), Firebase init, email+password auth, profile, shop CRUD + archive + switcher, rules v1 | sign up, create two shops, archive one, reload — state persists; rules deny cross-uid reads in the emulator |
| **2 Financial engine** | `money.ts`, `dates.ts`, `engine.ts`, `accrual.ts`, all nine transaction kinds, income configs, transaction CRUD with soft delete | ~40 unit tests green, including every scenario in §9 of the brief: advances not counted as earnings, expense + reimbursement nets to zero, pro-rata splits summing exactly, duplicate accrual impossible |
| **3 Dashboard & history** | dashboard cards with real totals, shop detail, transaction list with search/filter/sort, month selector, backdated entry flow | the dashboard figure equals the engine's figure for a fixture dataset; a backdated entry moves the right month |
| **4 Settlement & reports** | custom-range settlement, sealing, carry-forward, reconciliation, jsPDF per-shop and combined reports | seal a period, add a backdated entry, confirm the snapshot is unchanged and the next period carries the adjustment; PDF totals match the engine |
| **5 Reminders** | weekly/monthly/custom reminders, permission handling, history, completion | reminders fire in the browser; month-end clamping unit-tested |
| **6 Capacitor Android** | committed Android project, icons, splash, channels, boot rescheduling, back-button and keyboard handling, CI release workflow | a real APK built by CI and installed on a device; a scheduled notification fires with the app closed |
| **7 QA** | regression pass, rules tests, perf, docs, README | all tests green; manual pass on mobile + desktop + offline/online transition |

---

## Verification

- `npm run typecheck`, `npm run lint` (zero warnings), `npm run test` from `my-work-ledger/app`.
- Engine tests use realistic fixtures with an injected `today`, in `src/**/*.test.ts`.
- Firestore rules tested against the emulator with `@firebase/rules-unit-testing`:
  `npm run test:rules` from `app/`, with `npm run emulator` running. **Resolved:** unlike the
  Realtime Database emulator, which could not start in this sandbox because the egress policy
  blocks `firebase-public.firebaseio.com`, the Firestore emulator starts and runs normally, so
  the rules are genuinely exercised rather than reviewed by eye. The suite caught one real
  bug on first run — `sealedThroughDate` could be cleared back to `null`, reopening a sealed
  period — which is precisely why it is not optional.
- Headless browser pass per phase: no page errors, no horizontal overflow at 390 px, light and
  dark themes.
- Android: the APK must actually build in CI before any claim that it does; a notification
  must actually arrive on a device before reminders are called done.

---

## Phase 1 starts by

Creating `my-work-ledger/app` with the `transferbox` toolchain, then the design system, then
auth, then shops. The user needs to confirm the Firebase project and enable Email/Password
auth plus Firestore before auth can be exercised end to end; everything up to that point can
be built and tested without it, because the client is guarded by `isCloudConfigured()`.
