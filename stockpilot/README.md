# StockPilot AI

**Your Inventory. Just a Conversation Away.**

StockPilot is an inventory copilot for independent shops — pharmacies, grocers, hardware and convenience stores. Employees walk the aisles and *say* what they see (“three boxes of cough syrup left, four cases of AA batteries arrived”) or snap a photo of a shelf, delivery slip or expiry label. StockPilot turns that into proposed stock changes, a person confirms them, and every change lands in an immutable audit log.

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
| **AI review** | Every AI proposal shows transcript/photo evidence, matched product, change, confidence and warnings. Approve, edit, dismiss or “say it differently”. Large changes by employees route to a manager. |
| **Inventory** | Products, packagings (unit conversion only where defined), batches, FEFO, barcode lookup, CSV import/export, archive/delete safeguards. |
| **Stock engine** | One Postgres function applies every change atomically, with idempotency keys, role checks, FEFO batch deduction, stale-count protection and an immutable ledger. |
| **Expiry** | 7/15/30-day buckets, value at risk, batch write-off with loss tracking, daily alerts. |
| **Purchasing** | Low-stock reorder planning per supplier, owner approval, email/WhatsApp sending only after approval, receiving into batches, PDF. |
| **POS** | Square, Shopify, Clover adapters: OAuth, catalog pull, SKU/barcode mapping, verified + de-duplicated webhooks, reconciliation, retries. |
| **Notifications** | In-app, email digest, web push, WhatsApp; per-user channel and type preferences. |
| **Reports** | Daily changes, weekly summary, monthly valuation, expired/damaged loss, shrinkage, stockouts, reorder history, employee activity, AI accuracy — all CSV-exportable. |
| **PWA** | Installable, offline drafts in IndexedDB, background sync, never claims an unsynced change was applied. |

## Architecture

- **Next.js 16** (App Router, Turbopack, `proxy.ts`), React 19, TypeScript (strict), Tailwind CSS 4, shadcn-style components on Radix, Lucide, Recharts.
- **Supabase** — Postgres, Auth, Storage, Realtime publication. *The brief listed both Firebase and Supabase; Supabase alone is used because Row Level Security, SQL migrations and atomic Postgres transactions are core requirements, and running two identity systems would weaken security.*
- **AI** — provider interface with a Gemini implementation (structured JSON output) and a deterministic local parser. All model output is validated with Zod before use (`src/lib/ai/schemas.ts`).

```
Voice / photo ──► /api/voice/extract | /api/photo/analyze
                     │  (rate limited, validated, untrusted input)
                     ▼
              AI provider ──► Zod validation ──► ai_extractions (audit)
                     ▼
        proposal policy (match, convert units, risk, approver) ──► ai_review_queue
                     ▼
        person confirms ──► apply_review_item() ──► apply_stock_movement_internal()
                                                   (lock, FEFO, idempotency, ledger, alerts)
```

## Security model

- **Tenant isolation:** every table carries `business_id` and has RLS; `anon` has no access. Proven by `supabase/tests/database.test.ts` against a real Postgres.
- **Stock can't be edited directly:** column-level grants exclude `current_quantity`; the ledger has no write grants and an immutability trigger (even the service role can't edit it).
- **Roles in the database:** owner/manager/employee checks live in SQL functions; the UI only mirrors them. Employees' large adjustments raise `approval_required`.
- **Idempotency:** every movement needs a unique key; offline replays, double taps and duplicate webhooks apply once.
- **Stale data:** a count observed before the latest movement is refused (`stale_observation`) — protects against old photos and delayed POS counts.
- **Web:** nonce-based CSP, HSTS, `X-Frame-Options: DENY`, camera/mic limited to self, same-origin checks on state-changing APIs, Zod-validated inputs with size limits, magic-byte upload validation, private storage with signed URLs, Postgres-backed rate limits, AES-256-GCM encrypted POS tokens, single-use OAuth state, constant-time signature checks, CSV formula-injection protection, open-redirect protection.
- **Offline:** IndexedDB holds operation payloads only — never tokens. Signing out clears the queue and cached pages.

## Setup

Requirements: Node 20.9+, a Supabase project (or the Supabase CLI for local).

```bash
cd stockpilot
npm install
cp .env.example .env.local      # fill in Supabase URL + keys at minimum
```

Apply the database migrations (in order) — either:

```bash
supabase link --project-ref <ref> && supabase db push      # Supabase CLI
# or paste each file in supabase/migrations/ into the SQL editor, in order
```

In the Supabase dashboard:
1. **Auth → URL configuration:** set the Site URL to `NEXT_PUBLIC_APP_URL` and add `<APP_URL>/auth/callback` to redirect URLs.
2. **Storage:** the migration creates the private `inventory-media` bucket and its policies.

```bash
npm run dev   # http://localhost:3000 → sign up → create your store
```

To enable photo audits and smarter voice understanding set `AI_PROVIDER=gemini` and `GEMINI_API_KEY`.

## Deployment

Vercel (recommended): import the repo, set **Root Directory** to `stockpilot`, add the environment variables from `.env.example`, deploy. `vercel.json` schedules `/api/cron/daily` (expiry alerts, sync retries, scheduled POS pulls, notification delivery); set `CRON_SECRET` so only Vercel can call it.

POS webhooks to register with each provider:
- Square: `https://<app>/api/webhooks/square` (event `inventory.count.updated`)
- Shopify: registered automatically after OAuth (`inventory_levels/update`)
- Clover: `https://<app>/api/webhooks/clover`; the verification code is logged on first delivery — set it as `CLOVER_WEBHOOK_AUTH_CODE`.

## Testing

```bash
npm run lint
npm run typecheck
npm test            # unit tests: parsing, matching, units, policy, expiry, reorder, CSV, crypto, webhooks, offline queue, reconciliation
npm run test:db     # applies all migrations to a throwaway PostgreSQL 15+ and tests RLS, permissions and the stock engine
npm run build
```

`test:db` starts a temporary cluster using the local PostgreSQL server binaries (or uses `DATABASE_TEST_URL`). `supabase/tests/supabase-shim.sql` emulates Supabase's roles, `auth.uid()` and storage schema, including its permissive default grants — so the migrations are proven to lock things down themselves. CI runs all of the above (`.github/workflows/stockpilot-ci.yml`).

## Integration status

Being explicit about what has and hasn't been exercised:

| Integration | Status |
| --- | --- |
| Supabase schema, RLS, stock engine | Tested against PostgreSQL 16 (database suite). |
| Local voice parser | Unit tested, including the brief's example and the ambiguity case. |
| Gemini (voice, photo, transcription) | Implemented against the public REST API with structured output; **not yet run against a live key**. All outputs are schema-validated, so a malformed response is discarded rather than applied. |
| Square / Shopify / Clover | Implemented per published APIs; signature verification and reconciliation are unit tested. **Not yet tested against live merchant accounts — use sandbox first.** The UI labels them “Beta”. |
| Resend email, WhatsApp Cloud API, Web Push | Implemented; require your credentials. WhatsApp free-form messages only deliver inside an open 24-hour conversation; purchase orders always offer a prefilled `wa.me` link as fallback. |
| Google Sheets / Calendar | Not implemented. CSV export covers spreadsheet workflows today. |

## Project layout

```
stockpilot/
├─ supabase/migrations/      SQL: tenancy, inventory engine, AI review, purchasing, integrations, reports, views
├─ supabase/tests/           Postgres-backed security & behaviour tests
├─ src/proxy.ts              session refresh, auth redirects, nonce CSP
├─ src/app/(auth)/           sign in / up / reset
├─ src/app/(app)/            dashboard, inventory, voice, photo, review, expiring, movements, suppliers, purchase orders, reports, integrations, settings
├─ src/app/api/              voice, photo, review, stock, exports, PDF, integrations, webhooks, cron, push
├─ src/lib/domain/           pure business logic (units, matching, proposals, expiry, reorder, CSV, messages)
├─ src/lib/ai/               schemas, prompts, providers, local parser
├─ src/lib/integrations/     POS adapters, reconciliation, sync engine
├─ src/lib/security/         crypto, webhook signatures, upload checks, permissions
├─ src/lib/offline/          IndexedDB queue + replay
└─ public/sw.js              service worker
```
