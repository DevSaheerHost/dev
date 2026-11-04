# My Work Ledger

A personal ledger for working at more than one shop. It answers one question reliably at any
moment: **how much does each shop owe me right now, and why?**

Salary and allowances accrue whether or not they are paid. Expenses paid out of your own pocket
make the shop owe you more. Advances, salary payments and reimbursements reduce what is
outstanding. At the end of a period you can seal a statement and hand it over.

Live at **/my-work-ledger/**. Built to be used daily on a phone, offline, and to survive a
reinstall.

> **Status: Phase 2 of 7 — the financial engine.** Accounts, shops, the money/date core, the
> balance engine, salary accrual and the entry data layer are done and tested. What is *not*
> built yet is the screen for any of it: there is no form to add an entry and no transaction
> list, so the dashboard still shows only opening balances and says so on screen rather than
> showing plausible numbers that are not real. Phase 3 puts the engine on screen. Settlements,
> PDF reports, reminders and the Android build come after that. See
> [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full plan.

---

## The money rules

These are the part that has to be right, so they are stated plainly and enforced in one place.

**Every amount is an integer number of paise.** Never a float. `parseRupeesToPaise("8.17")` is
`817`, not `8.17 * 100` — which is `816.9999999999999` in binary floating point. More than two
decimal places is **rejected**, not rounded: silently turning `100.456` into ₹100.46 is how a
ledger loses money.

**Every date is a calendar day, `YYYY-MM-DD`** — not a timestamp. A payment on 4 November stays
4 November on a phone that crosses a timezone. `lib/dates.ts` is the only module allowed to
construct a `Date`, and a test enforces that.

**Positive means the shop owes you.**

| Entry | Effect | Note |
| --- | --- | --- |
| Salary earned | **+** | accrual, not cash |
| Allowance earned | **+** | food / daily / weekly / monthly |
| Other income earned | **+** | overtime, bonus, custom |
| Expense paid *(reimbursable, your money)* | **+** | you funded the shop; it owes you |
| Expense paid *(non-reimbursable or shop float)* | **0** | a cost record only, not a receivable |
| Advance received | **−** | money received — **never an earning** |
| Salary payment received | **−** | money received |
| Reimbursement received | **−** | money received against expenses |
| Deduction | **−** | the shop reduces what it owes; no cash moves |
| Adjustment | **±** | signed manual correction, reason required |

**Double counting is prevented structurally, not hopefully:**

- An expense is recorded **once** as an expense (+); the money coming back is recorded **once**
  as a reimbursement (−). Net zero.
- *"Adjusted against salary" is not a third mechanic.* ₹10,000 salary plus a ₹200 expense, paid
  to you as ₹10,200, is **one** salary payment of ₹10,200. The app says this plainly instead of
  offering a third option, because a third option is exactly how expenses get counted twice.
- Document ids are minted by the client, so a retried write lands on the **same** document.
  Accrual ids are deterministic (`acc_{configId}_{period}`), so two attempts to post one month's
  salary are not merely discouraged — they are the same document.

**Nothing is ever deleted.** Shops are archived, entries are voided, income configs are
deactivated. A sealed statement cannot be altered at all: a backdated entry keeps its true date,
marks the statement as needing reconciliation, and is counted in the current open period. The
security rules enforce every sentence in this paragraph, not just the UI.

---

## Running it

```bash
cd app
npm install
npm run dev            # http://localhost:5173
```

| Command | What it does |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit`, strict, with `noUncheckedIndexedAccess` |
| `npm run lint` | ESLint at `--max-warnings 0` |
| `npm run test` | Vitest unit tests — no emulator, Java or network needed |
| `npm run build` | typecheck, build, then publish into `my-work-ledger/` |
| `npm run emulator` | Firestore + Auth emulators for local work |
| `npm run test:rules` | security rules against the emulator (start it first) |

The build publishes into the parent folder so the site serves `/my-work-ledger/` with no `dist`
segment in the URL. **The built output is committed, so rebuild before committing.**

### Working against the emulators

```bash
# terminal 1, from my-work-ledger/
npx firebase emulators:start --only firestore,auth --project my-web-b35e3

# terminal 2, from my-work-ledger/app/
VITE_FIREBASE_EMULATOR=1 npm run dev
```

The emulator connection is wrapped in `import.meta.env.DEV`, so the branch is removed from a
production bundle entirely — a shipped build cannot be pointed at an unauthenticated emulator
by setting an environment variable.

---

## Firebase setup

Project: **`my-web-b35e3`**, dedicated to this app.

### Deploying the rules

```bash
cd my-work-ledger
npm install -g firebase-tools
firebase login
./deploy.sh
```

This deploys `firebase/firestore.rules` and `firebase/firestore.indexes.json` only. It never
touches data. Because the project is dedicated to this app, the rules file is the complete
ruleset — if you ever add another app to the same project, merge its rules into this file rather
than deploying them separately, since each deploy replaces the whole ruleset.

### Console steps that cannot be done from code

1. **Authentication → Sign-in method → enable Email/Password.** Until this is done, sign-up
   fails with "Email sign-in is not enabled on this Firebase project yet."
2. **Firestore Database → create database** (production mode; the rules above replace whatever
   it starts with).
3. **Then turn self-signup off.** This is a personal ledger. The rules isolate every account by
   uid, so another account could never read your data — but there is no reason to leave account
   creation open once yours exists. Firebase does not expose a switch for this directly; block
   it with an Identity Platform blocking function, or accept the residual risk knowingly.
4. **Restrict the API key** in the Google Cloud console to this site's referrers.
5. **Enable App Check** (reCAPTCHA v3) and set `VITE_FIREBASE_APPCHECK_SITE_KEY`.

### On the web config being committed

`app/.env.production` contains the Firebase web config and is committed deliberately. Those
values are not credentials: the client SDK ships them inside every browser bundle, and this
repository already serves that bundle publicly, so hiding the file would conceal nothing while
making a rebuild from a fresh clone impossible.

What actually protects the data is the rules file, sign-in, the API key restriction and App
Check. **Admin SDK and service-account credentials are a completely different matter and must
never appear in this repository.**

---

## Layout

```
my-work-ledger/
├── index.html, assets/          built output (committed, served at /my-work-ledger/)
├── firebase/
│   ├── firestore.rules          the security boundary
│   ├── firestore.indexes.json   composite indexes
│   └── INDEXES.md               what each index is for
├── firebase.json, .firebaserc, deploy.sh
├── docs/ARCHITECTURE.md         money rules, schema, phase plan, risks
└── app/
    ├── scripts/
    │   ├── publish.mjs          dist -> parent folder
    │   └── test-rules.mjs       rules tests against the emulator
    └── src/
        ├── lib/                 money, dates, clock, ids — no React, no Firestore
        ├── types/models.ts      exactly what Firestore stores
        ├── data/                Firebase client, validated paths, shops, entries, configs
        ├── features/
        │   ├── ledger/          engine, accrual, posting — pure, no React, no clock
        │   ├── auth/
        │   └── shops/
        ├── components/          UI primitives and the app shell
        ├── pages/               dashboard, settings
        └── hooks/               theme, online status
```

**The boundary that matters:** `lib/` and `features/ledger/` know nothing about React,
Firestore or the current time — "today" is always an argument. That is what makes a balance
reproducible in a test, on a phone and in a PDF. Components render values that arrive already
computed; there is no arithmetic in JSX.

**One behaviour worth knowing about:** a Firestore write promise resolves when the *server*
acknowledges it, so offline it stays pending indefinitely. Every mutation in `data/` therefore
returns immediately with a client-minted id and hands back a separate `synced` promise that
nothing in the UI awaits. See `data/writes.ts`.

---

## What is verified, and how

Phase 1 was checked by running things, not by assuming:

- **146 unit tests**, all pure and needing no emulator, network or Java:
  - *money and dates (40)* — exact-sum pro-rata splits, the `8.17` float trap, leap years,
    month clamping, and a guard test that fails if `new Date(` appears outside `lib/dates.ts`
    and `lib/clock.ts`.
  - *engine (36)* — the sign of all nine kinds, every scenario in the money rules above,
    period membership by recognition date, running balances, and the integrity warnings.
  - *accrual (34)* — nothing proposed before it is earned, a month never proposed twice,
    calendar-day pro-rata in short and leap months, a mid-month raise tiling the month
    exactly, and never accruing behind the opening-balance date.
  - *posting (24)* — recognition dates around a seal, sort-key ordering, validation, and the
    cash-bonus pair netting to zero.
  - *defensive reads (12)* — a malformed stored document can never produce `NaN` and poison
    every total on the screen.
- **23 security rules tests** against the Firestore emulator: cross-account denial, forged
  `uid`, field whitelists, immutable amounts and dates, income-config validation, a re-posted
  accrual being refused, sealed-statement immutability, append-only audit logs, and the
  collection-group query constraint.
- **An end-to-end browser pass** at 390px: sign up, create two shops with opposite balance
  directions, reject `100.456`, archive one shop, reload and confirm it persisted, rename,
  switch theme, sign out. No console errors, no horizontal overflow.
- **An offline pass**: with the network cut, adding a shop closes the form in ~200ms and the
  shop appears; archiving works too; on reconnect a *fresh page* shows both changes, proving
  they reached the server and not just the local cache.

**Not verified:** sign-in against the live `my-web-b35e3` project. Email/Password is not enabled
there yet and this environment has no credentials to enable it, so that path has only been
exercised against the Auth emulator.
