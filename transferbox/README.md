# TransferBox

Move large text, images, videos and arbitrary files between any two browsers.
No accounts, no installs, no sign-in — open the page on one device, paste
something, open it on another, and it is there.

Live: <https://saheerlab.vercel.app/transferbox/>

```
transferbox/
├── app/                 Vite + React + TypeScript source
├── firebase/            Realtime Database and Storage security rules
├── index.html           built app (generated — served at /transferbox/)
└── assets/              built bundles (generated)
```

---

## What it does

| | |
| --- | --- |
| **Text transfer** | Paste up to 3 MB. Live character count and byte size, retention from 1 hour to forever, searchable history, one-click copy. |
| **File transfer** | Any browser-supported file up to 3 MB, stored byte-for-byte: no compression, no re-encoding. Filename, MIME type, size and timestamps are preserved. |
| **Public workspace** | The default. Works instantly, shared with everyone, and says so in plain words. |
| **Private workspace** | Created from a 256-bit Web Crypto secret, shared by QR or link. Content is encrypted on the device before upload — the server stores ciphertext under an identifier derived from the secret. |
| **QR transfer** | Large text is chunked across many QR frames with a per-transfer SHA-256, played as a sequence, reassembled and verified by the receiver. Works with no network at all. |
| **Direct transfer** | WebRTC data channel between two browsers, with Firebase used only for the handshake. The bytes never touch the cloud. |
| **Offline** | Installable PWA. Cached history stays readable offline, new items queue locally and upload when the connection returns — and the interface says which state each item is in. |

---

## Architecture

```
  Browser A                                          Browser B
     │                                                   │
     │  ── Save & Sync ────────────────────────────────►  │
     │     Realtime Database  (metadata only)             │
     │     Cloud Storage      (bytes)                     │
     │                                                    │
     │  ── QR Transfer ───────────────────────────────►   │
     │     screen → camera, no network involved           │
     │                                                    │
     │  ── Direct Transfer ───────────────────────────►   │
     │     RTDB carries the SDP handshake only,           │
     │     then WebRTC DataChannel carries the bytes      │
```

### Layers

```
src/
├── crypto/      workspace secrets, key derivation, AES-GCM, SHA-256
├── qr/          TBX1 chunking protocol, rendering, camera scanning
├── webrtc/      pairing, signalling over RTDB, chunked send with verification
├── firebase/    SDK bootstrap and every database/storage path builder
├── services/    item service (save, fetch, delete), clipboard
├── storage/     IndexedDB: history cache, offline queue, preferences
├── stores/      workspace and draft context
├── hooks/       items + sync state, routing, theme, connectivity
├── components/  interface primitives and feature panels
└── pages/       Home, History, Transfer, Workspace, Settings
```

Business logic never touches the DOM, components never talk to Firebase
directly, and `firebase/paths.ts` is the only module that builds a path.

### Data model

```
workspaces/
  public/
    items/{itemId}            readable fields: type, size, timestamps,
                              preview, small text bodies, storage path
  private/{workspaceId}/      workspaceId = SHA-256("…/id" + secret)
    metadata/
    items/{itemId}            enc: AES-GCM envelope; everything identifying
                              (name, MIME type, preview, body) is inside it
signals/{pairCode}            SDP offer/answer + ICE candidates, 10-minute TTL
```

Storage mirrors it:

```
workspaces/public/{itemId}/{fileName}
workspaces/private/{workspaceId}/{itemId}/{fileName}
```

Binary data never goes into the database — only metadata and, for small text,
the body itself (under 16 KB). Larger text is uploaded as a Storage object with
a 280-character preview left in the record, so history lists stay small.

### Private workspaces, concretely

1. `crypto.getRandomValues` produces a 256-bit secret. `Math.random` is never
   used for anything security-relevant.
2. Two independent values are derived from it:
   `workspaceId = SHA-256("transferbox/v1/id:" + secret)` (first 128 bits, hex)
   and `contentKey = SHA-256("transferbox/v1/key:" + secret)` as an AES-GCM key.
3. The id goes to the server. The secret and the key never leave the device.
4. Every item is sealed with AES-GCM before upload; the metadata the server can
   see is a type, a size, two timestamps and an opaque blob.
5. Sharing puts the secret in the URL **fragment** (`#/workspace?join=…`), which
   browsers do not send to servers. Once stored, the app rewrites the address
   bar to drop it.

Consequences, stated honestly: anyone holding the link has full access, and a
lost link cannot be recovered — there is nothing on the server that could
rebuild it.

---

## Firebase setup

The app needs a Firebase project with **Realtime Database** and **Cloud
Storage** enabled. No Authentication provider is required — TransferBox has no
accounts by design.

`firebase.json` and `.firebaserc` in this folder are already configured, so the
whole backend setup is one command:

```bash
npm install -g firebase-tools
firebase login            # one-time, opens a browser
./deploy.sh               # rules + CORS, in that order
```

`deploy.sh` targets the project in `.firebaserc` and the bucket
`<project>.appspot.com`; override either with `FIREBASE_PROJECT` or
`FIREBASE_BUCKET`. To run the steps yourself:

```bash
firebase deploy --only database,storage
gcloud storage buckets update gs://<your-bucket> --cors-file=firebase/cors.json
```

The Storage rules have been compiled locally against the Firebase emulator. The
Database rules are validated as JSON here and compiled server-side by
`firebase deploy`, which rejects an invalid ruleset without touching the rules
already live.

### Realtime Database rules

`firebase/database.rules.json`. The root is closed (`".read": false`,
`".write": false`) and access is opened per path:

- **`workspaces/public/items`** — readable and writable by anyone, which is what
  "public" means, but every write is validated: a whitelisted set of fields, a
  3 MB size ceiling, a bounded `createdAt`, an item id matching
  `^[A-Za-z0-9_-]{8,64}$`, a `storagePath` that must start with
  `workspaces/public/` and contain no `..`, and `$other: {".validate": false}`
  so no unknown field can be added. Items may be created and deleted, never
  edited in place.
- **`workspaces/private`** — `".read": false`, so the list of private
  workspaces cannot be enumerated. Read and write are granted one level deeper,
  at `workspaces/private/$workspaceId`, only for ids matching `^[0-9a-f]{32}$`.
  Possession of the 128-bit identifier is the access check, and it is derived
  from a secret the server never receives. Private records must carry `enc` and
  are forbidden from carrying `preview`, `text`, `fileName` or `mimeType`, so a
  client cannot accidentally write plaintext into a private workspace.
- **`signals/$code`** — pairing records with a validated shape, a 15-minute
  maximum TTL, and SDP/candidate size limits.

### Storage rules

`firebase/storage.rules`. Both zones deny `list`, so objects can only be
fetched by someone who already knows the full path; writes are capped at 3 MB,
restricted to path segments matching the same patterns as the database rules,
and objects are immutable once written (expiry is a delete, not an update).
Active content types (HTML, XHTML, SVG, anything JavaScript) are refused, so
nothing stored here can be served back as a live page. Everything outside the
two workspace prefixes is closed.

### Storage CORS

Downloads read object **bytes** (they have to: private objects are decrypted in
the browser, and every download is verified against its stored SHA-256), so the
bucket must allow cross-origin reads from the app's origin. Without this,
uploads succeed and downloads fail. `firebase/cors.json` is ready to apply:

```bash
gcloud storage buckets update gs://<your-bucket> --cors-file=firebase/cors.json
# or, with the older tool:
gsutil cors set firebase/cors.json gs://<your-bucket>
```

Add your own origins to that file before applying it.

### Environment variables

Configuration comes from environment variables — see `app/.env.example`:

```
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
VITE_FIREBASE_DATABASE_URL   # optional, derived from the project id if omitted
```

Copy it to `app/.env.local` (git-ignored) for development, and set the same
variables in your hosting provider for production builds.

A Firebase **web** config is not a credential: it ships inside every browser
bundle by definition, and the security boundary is the rules above, not the
config. Admin SDK service-account credentials are a different thing entirely —
they are never used by this app and must never be placed in the frontend.

If configuration is missing, the app still runs: cloud sync reports
"Local only", and QR transfer continues to work with no backend at all.

---

## Local development

```bash
cd app
npm install
cp .env.example .env.local     # then fill in your project's values
npm run dev                    # http://localhost:5173
```

Other scripts:

```bash
npm run typecheck   # tsc --noEmit, strict mode
npm run lint        # eslint, zero warnings allowed
npm run test        # vitest — protocol, crypto, expiry, validation
npm run build       # typecheck + build + publish to ../ for static hosting
```

### Production build

`npm run build` writes to `app/dist` and then copies the result up to
`transferbox/`, so the static host serves the app at `/transferbox/` with no
`dist` segment in the URL. `base` is relative, so the same build works from any
path or domain. The generated `index.html` and `assets/` are committed on
purpose: this repository is served as static files with no build step.

---

## PWA

`public/manifest.webmanifest` plus a hand-written `public/sw.js` (no build-time
plugin). The strategy is deliberately small:

- navigations: network first, falling back to the cached shell, so an offline
  launch still opens the app;
- same-origin hashed assets: cache first — a content-hashed file can never be
  stale;
- Firebase and Storage requests: never cached, because stale workspace data
  would be worse than none.

Offline behaviour: cached history stays visible, new items are queued in
IndexedDB with their Blob intact, and the header shows **Offline → Syncing →
Synced**, or **Sync failed**. Nothing is ever displayed as synced while it is
only local.

---

## QR protocol (TBX1)

One frame:

```
TBX1|<transferId>|<index>|<total>|<sha256-hex>|<base64url chunk>
```

| Field | Meaning |
| --- | --- |
| `TBX1` | protocol version |
| `transferId` | 8 characters, so frames from two transfers can never be merged |
| `index` | zero-based frame number |
| `total` | number of frames |
| `sha256-hex` | SHA-256 of the **entire** payload, repeated on every frame |
| chunk | 480 raw bytes, base64url encoded |

A compact pipe-separated header is used rather than a JSON envelope because it
costs about 90 bytes per frame instead of roughly 200, and no frame ever
carries the whole payload. 480 bytes per chunk keeps each code around QR
version 20 at error-correction level M — dense enough to be efficient, sparse
enough for a phone camera at an angle.

Receiving: frames may arrive in any order, duplicates are counted once, frames
from another transfer are rejected, and the receiver lists exactly which
indexes are still missing. When every index is present the payload is
reassembled and hashed; it is accepted only if the digest matches the one the
frames carried. A corrupted scan is reported as corrupted, never silently
accepted.

The sender shows the frame count up front ("27 QR frames"), auto-plays with
pause and step controls, and, for very long sequences, a jump-to-frame control
plus a note that Save & Sync or Direct Transfer would be quicker.

---

## WebRTC architecture

```
Browser A  ──offer──►  RTDB signals/{code}  ◄──answer──  Browser B
      ▲                                                     │
      └──────── ICE candidates via the same record ─────────┘

            then:  A ◄══ DataChannel (bytes) ══► B
```

One browser creates an 8-character pairing code drawn from
`crypto.getRandomValues`, publishes an offer, and shows the code as text and as
a QR. The other joins with that code. Once the channel opens, payloads are sent
in 16 KB chunks with back-pressure (`bufferedAmountLow`), preceded by a
metadata message carrying the SHA-256 of the payload. The receiver rebuilds the
Blob, recomputes the hash and reports **✓ Transfer complete · integrity
verified**, or states plainly that verification failed.

The signalling record is deleted on disconnect and when the session ends, and
expires within 10 minutes regardless.

---

## Automatic expiration

Every item carries `createdAt` and `expiresAt` (or `null` for "keep until I
delete it"). Expired items are hidden immediately by every client, and any
browser that sees an expired record deletes it along with its Storage object.

**Known limitation:** that sweep only runs while some browser has the workspace
open. If a workspace is never opened again, its expired records stay in the
database until something deletes them. No backend scheduler is configured in
this repository. Deploying one is the fix — a scheduled Cloud Function, run
hourly:

```js
// functions/cleanup.js — backend only. Uses Admin SDK credentials, which must
// never appear in the frontend bundle.
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');
admin.initializeApp();

exports.cleanupExpired = onSchedule('every 60 minutes', async () => {
  const now = Date.now();
  const db = admin.database();
  const bucket = admin.storage().bucket();

  const sweep = async (path) => {
    const snapshot = await db.ref(path).once('value');
    const updates = {};
    snapshot.forEach((child) => {
      const item = child.val();
      if (item?.expiresAt && item.expiresAt <= now) {
        updates[child.key] = null;
        if (item.storagePath) bucket.file(item.storagePath).delete().catch(() => {});
      }
    });
    if (Object.keys(updates).length) await db.ref(path).update(updates);
  };

  await sweep('workspaces/public/items');
  const priv = await db.ref('workspaces/private').once('value');
  for (const ws of Object.keys(priv.val() ?? {})) {
    await sweep(`workspaces/private/${ws}/items`);
  }
});
```

---

## Security notes

- No passwords, no accounts, nothing personal is collected or stored.
- Workspace secrets come from `crypto.getRandomValues`; `Math.random` is not
  used for any token.
- Secrets are never logged, never sent to the server, never placed in a query
  string, and are revealed in the interface only on explicit request.
- Private-workspace content is sealed with AES-GCM before upload; the key is
  derived from the secret and never leaves the device.
- Uploads are validated for size and content type on the client, and again by
  the Storage rules, which are the actual enforcement point.
- Filenames are sanitised before they are used in a storage path; the original
  name is preserved in metadata.
- The browser-supplied MIME type decides an icon, never how bytes are handled.
- Every path segment is validated against a strict pattern before it reaches a
  database or storage reference, so user input cannot escape its subtree.
- QR frames are validated for index range, totals, checksum format and transfer
  identity, and the reassembled payload is verified against SHA-256.
- Raw SDK errors are never shown; each failure maps to a sentence describing
  what to do next, with technical detail logged in development only.

---

## Known browser limitations

| Feature | Requirement | Without it |
| --- | --- | --- |
| Save & Sync | Firebase config | "Local only": QR and direct transfer still work |
| Scan QR | camera permission | Showing QR codes still works; scanning is hidden |
| Direct transfer | WebRTC | Panel explains the alternatives |
| Direct transfer across strict NATs | a TURN server (not configured) | Falls back with "direct connection failed" — use Save & Sync |
| Paste button | Clipboard read permission | The button is hidden; Ctrl/Cmd+V still works |
| Private workspaces | Web Crypto (secure context) | Reported as unavailable in Settings |
| Offline history | IndexedDB | The app works, nothing is cached |

Settings lists what the current browser supports. No missing API ever blocks
the whole app.

Tested manually in desktop Chromium and at phone viewport sizes (390 × 844),
light and dark, with keyboard-only navigation.

---

## Future improvements

- A TURN server so direct transfer works behind symmetric NATs.
- Raising the size ceiling: the pipeline is chunked and Blob-based already, so
  it is `MAX_FILE_BYTES` plus the matching rule limits, not a rewrite.
- Resumable uploads for large files over unreliable connections.
- Receiving files (not just text) over QR, using the same TBX1 framing.
- A scheduled cleanup function, as above.
- Optional passphrase-wrapped workspace secrets, so a share link can be sent
  through a channel you do not fully trust.
