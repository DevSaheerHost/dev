# StockPilot AI

**Your Inventory. Just a Conversation Away.**

StockPilot is an inventory copilot for independent shops — pharmacies, grocers, hardware and convenience stores. Employees walk the aisles and *say* what they see (“three boxes of cough syrup left, four cases of AA batteries arrived”) or snap a photo of a shelf, delivery slip or expiry label. StockPilot turns that into proposed stock changes, a person confirms them, and every change lands in an append-only audit log.

Built on **Next.js 16 + Firebase** (Auth, Firestore, Storage).

## Contents

- [What's inside](#whats-inside)
- [Architecture](#architecture)
- [Security model](#security-model)
- [Setup](#setup)
- [Deployment](#deployment)
- [Testing](#testing)
- [Integration status](#integration-status)
- [Project layout](#project-layout)

## What's inside

| Area | Highlights |
| --- | --- |
| **Voice audit** | Live transcription (Web Speech API) or server transcription (Gemini), editable transcript, multi-product extraction, clarification questions (“Do you mean five batteries are available, or five new ones arrived?”), confirm-then-apply. |
| **Photo audit** | Shelf / packing slip / damage / expiry-label modes, on-device downscaling (strips EXIF/GPS), visible-vs-confirmed quantities. A shelf photo **never** becomes a stock count by itself. |
| **Product matching** | Name, synonyms, SKU, barcode, brand, category, colour and strength signals with confidence tiers (≥95 % strong, 80–94 % suggest, <80 % pick). Near-ties always ask the person. |
| **AI review** | Every proposal shows the evidence, matched product, change, confidence and warnings. Approve, edit, dismiss or “say it differently”. Large changes by employees route to a manager. |
| **Inventory** | Products, packagings (unit conversion only where defined), batches, FEFO, barcode lookup, CSV import/export, archive/delete safeguards. |
| **Stock engine** | Firestore transactions apply every change atomically with idempotency, role checks, FEFO batch deduction, stale-count protection and an append-only ledger. |
| **Expiry** | 7/15/30-day buckets, value at risk, batch write-off with loss tracking, daily alerts. |
| **Purchasing** | Low-stock reorder planning per supplier, owner approval, email/WhatsApp sending only after approval, receiving into batches, PDF. |
| **POS** | Square, Shopify, Clover adapters: OAuth, catalog pull, SKU/barcode mapping, verified + de-duplicated webhooks, reconciliation, retries. |
| **Notifications** | In-app, email digest, web push, WhatsApp; per-user channel and type preferences. |
| **Reports** | Daily changes, weekly summary, monthly valuation, expired/damaged loss, shrinkage, stockouts, reorder history, employee activity, AI accuracy — all CSV-exportable. |
| **PWA** | Installable, offline drafts in IndexedDB, background sync, never claims an unsynced change was applied. |

## Architecture

- **Next.js 16** (App Router, Turbopack, `proxy.ts`), React 19, TypeScript (strict), Tailwind CSS 4, shadcn-style components on Radix, Lucide, Recharts.
- **Firebase Auth** — email/password in the browser; the ID token is immediately exchanged for an **httpOnly session cookie** (`/api/auth/session`). The browser keeps no Firebase tokens (in-memory persistence).
- **Cloud Firestore** — every business's data lives under `businesses/{businessId}/…` (see `src/lib/data/model.ts`). The **Next.js server is the only client**, via the Admin SDK.
- **Firebase Storage** — private photos/recordings, served through short-lived signed URLs.
- **AI** — provider interface with Gemini (structured JSON output) and a deterministic local parser. All model output is validated with Zod before use.

```
Voice / photo ──► /api/voice/extract | /api/photo/analyze   (rate limited, validated)
                     ▼
              AI provider ──► Zod validation ──► aiExtractions (audit)
                     ▼
     proposal policy (match, convert units, risk, approver) ──► reviewItems
                     ▼
     person confirms ──► applyReviewItem() ──► Firestore transaction:
                         planMovement() (pure rules) → batches, product, movement
```

## Security model

- **No direct database access from browsers.** `firebase/firestore.rules` and `firebase/storage.rules` deny everything; a leaked web API key exposes nothing. All access goes through server code that has verified the session cookie (signature, expiry, **revocation**), the business membership and the role.
- **Structural tenant isolation:** every query starts from `businesses/{businessId}` where the id comes from the verified membership, never from user input.
- **Roles enforced server-side** in `src/lib/data/*` (owner / manager / employee). Employees' large adjustments, corrections and transfers require a manager.
- **Atomic, idempotent stock changes:** movement document ids are derived from idempotency keys and created inside the same transaction, so double taps, offline replays and duplicate webhooks apply once. Concurrent writers are serialized by Firestore transactions.
- **Stale data refused:** a count observed before the latest movement is rejected (`stale_observation`) — protects against old photos and delayed POS counts.
- **Append-only ledger:** movements are only ever created by the stock engine; no code path updates or deletes them, and clients can't write at all.
- **Invitations** are single-use, hashed, expire in 7 days and require a **verified** email that matches.
- **Web:** nonce-based CSP, HSTS, `X-Frame-Options: DENY`, camera/mic limited to self, same-origin checks on state-changing APIs, Zod-validated inputs with size limits, magic-byte upload validation, Firestore-backed rate limits, AES-256-GCM encrypted POS tokens, single-use OAuth state, constant-time signature checks, CSV formula-injection protection, open-redirect protection.
- **Offline:** IndexedDB holds operation payloads only — never tokens. Signing out revokes sessions and clears the queue and cached pages.

## Setup

Requirements: Node 20.9+, a Firebase project (Blaze plan for Storage signed URLs / App Hosting). Java 21 only for the local emulators.

1. **Firebase console**
   - Create a project → **Build → Authentication** → enable **Email/Password**.
   - **Build → Firestore Database** → create (production mode).
   - **Build → Storage** → get started.
   - **Project settings → General → Your apps** → add a **Web app**; copy its config.
2. **Configure**
   ```bash
   cd stockpilot
   npm install
   cp .env.example .env.local     # fill in the Firebase web config + Admin credentials
   ```
3. **Deploy rules and indexes**
   ```bash
   npx firebase login
   npx firebase use --add          # pick your project
   npx firebase deploy --only firestore:rules,firestore:indexes,storage
   ```
4. **Authorized domains:** Authentication → Settings → Authorized domains → add your app's domain.
5. **Run**
   ```bash
   npm run dev                     # http://localhost:3000 → sign up → create your store
   ```

To run completely offline against emulators, uncomment the emulator variables in `.env.local` and run `npx firebase emulators:start --project demo-stockpilot` in another terminal.

For photo audits and smarter voice understanding set `AI_PROVIDER=gemini` and `GEMINI_API_KEY`.

## Deployment

**Firebase App Hosting (recommended for a Firebase stack):** edit `apphosting.yaml` with your values, set secrets (`npx firebase apphosting:secrets:set cronSecret` …), then create a backend in the console (App Hosting → Get started → connect this GitHub repo, **root directory `stockpilot`**). The Admin SDK uses the backend's service account automatically. Schedule `/api/cron/daily` with Cloud Scheduler (HTTP GET, header `Authorization: Bearer <CRON_SECRET>`).

**Vercel (also works):** new project, **Root Directory `stockpilot`**, add all variables from `.env.example` including the service account (`FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`). `vercel.json` schedules the daily cron.

POS webhooks to register with each provider:
- Square: `https://<app>/api/webhooks/square` (event `inventory.count.updated`)
- Shopify: registered automatically after OAuth (`inventory_levels/update`)
- Clover: `https://<app>/api/webhooks/clover`; the verification code is logged on first delivery — set it as `CLOVER_WEBHOOK_AUTH_CODE`.

## Testing

```bash
npm run lint
npm run typecheck
npm test              # unit: stock rules, parsing, matching, units, policy, reports, expiry, reorder, CSV, crypto, webhooks, offline queue
npm run test:firebase # starts the Firestore + Auth emulators and runs the data-layer and security-rules tests
npm run build
```

`test:firebase` exercises the real Firestore transactions: tenant isolation, idempotency under concurrent duplicate submissions, no lost updates under concurrent sales, FEFO, stale counts, role limits, review approval, the purchase-order lifecycle, rate limiting — and proves the rules reject a signed-in browser client. CI runs all of the above (`.github/workflows/stockpilot-ci.yml`).

## Integration status

| Integration | Status |
| --- | --- |
| Firebase Auth, Firestore, Storage | Tested end-to-end against the Firebase emulators (unit + integration tests and a full browser journey). |
| Local voice parser | Unit tested, including the brief's example and the ambiguity case. |
| Gemini (voice, photo, transcription) | Implemented against the public REST API with structured output; **not yet run against a live key**. Malformed responses are discarded, never applied. |
| Square / Shopify / Clover | Implemented per published APIs; signature verification and reconciliation are unit tested. **Not yet tested against live merchant accounts — use sandbox first.** The UI labels them “Beta”. |
| Resend email, WhatsApp Cloud API, Web Push | Implemented; require your credentials. WhatsApp free-form messages only deliver inside an open 24-hour conversation; purchase orders always offer a prefilled `wa.me` link as fallback. |
| Google Sheets / Calendar | Not implemented. CSV export covers spreadsheet workflows today. |

## Project layout

```
stockpilot/
├─ firebase/                 firestore.rules, storage.rules, indexes, rules tests
├─ firebase.json             emulator + deploy config
├─ apphosting.yaml           Firebase App Hosting config
├─ src/proxy.ts              nonce CSP, auth redirects
├─ src/app/(auth)/           sign in / up / reset
├─ src/app/(app)/            dashboard, inventory, voice, photo, review, expiring, movements, suppliers, purchase orders, reports, integrations, settings
├─ src/app/api/              auth session, voice, photo, review, stock, exports, PDF, integrations, webhooks, cron, push
├─ src/lib/data/             Firestore data layer (tenancy, roles, transactions)
├─ src/lib/domain/           pure business rules (stock engine, units, matching, proposals, reports, expiry, reorder, CSV)
├─ src/lib/ai/               schemas, prompts, providers, local parser
├─ src/lib/integrations/     POS adapters, reconciliation, sync engine
├─ src/lib/security/         crypto, webhook signatures, upload checks, permissions
├─ src/lib/offline/          IndexedDB queue + replay
└─ public/sw.js              service worker
```
