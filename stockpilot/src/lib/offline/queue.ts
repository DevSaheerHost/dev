/**
 * Offline operation queue (IndexedDB).
 *
 * - Every operation carries a client-generated id that doubles as the server
 *   idempotency key, so replaying after a flaky connection can never apply a
 *   change twice.
 * - Only operation payloads are stored. No credentials or tokens are ever
 *   written here (auth stays in httpOnly cookies).
 * - Network failures keep the operation for retry; definitive rejections
 *   (4xx) are kept with an error so the user can see and discard them.
 */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export type OfflineOperationKind = "voice_draft" | "photo_draft" | "review_apply" | "stock_movement";

export interface OfflineOperation {
  id: string;
  kind: OfflineOperationKind;
  businessId: string;
  /** Short human description shown in the pending list. */
  label: string;
  payload: unknown;
  createdAt: number;
  attempts: number;
  status: "pending" | "failed";
  lastError?: string;
}

interface QueueSchema extends DBSchema {
  operations: { key: string; value: OfflineOperation; indexes: { byCreated: number } };
  blobs: { key: string; value: { id: string; blob: Blob; type: string } };
}

const DB_NAME = "stockpilot-offline";
let dbPromise: Promise<IDBPDatabase<QueueSchema>> | null = null;

function db(): Promise<IDBPDatabase<QueueSchema>> {
  dbPromise ??= openDB<QueueSchema>(DB_NAME, 1, {
    upgrade(database) {
      const store = database.createObjectStore("operations", { keyPath: "id" });
      store.createIndex("byCreated", "createdAt");
      database.createObjectStore("blobs", { keyPath: "id" });
    },
  });
  return dbPromise;
}

/** For tests: forget the cached connection. */
export function resetQueueConnection(): void {
  dbPromise = null;
}

export async function enqueue(op: Omit<OfflineOperation, "createdAt" | "attempts" | "status">, blob?: Blob): Promise<boolean> {
  const database = await db();
  const tx = database.transaction(["operations", "blobs"], "readwrite");
  if (await tx.objectStore("operations").get(op.id)) {
    await tx.done;
    return false; // already queued: no duplicates
  }
  await tx.objectStore("operations").put({ ...op, createdAt: Date.now(), attempts: 0, status: "pending" });
  if (blob) await tx.objectStore("blobs").put({ id: op.id, blob, type: blob.type });
  await tx.done;
  notifyChange();
  return true;
}

export async function listOperations(businessId?: string): Promise<OfflineOperation[]> {
  const all = await (await db()).getAllFromIndex("operations", "byCreated");
  return businessId ? all.filter((o) => o.businessId === businessId) : all;
}

export async function getBlob(id: string): Promise<Blob | null> {
  return (await (await db()).get("blobs", id))?.blob ?? null;
}

export async function removeOperation(id: string): Promise<void> {
  const database = await db();
  const tx = database.transaction(["operations", "blobs"], "readwrite");
  await tx.objectStore("operations").delete(id);
  await tx.objectStore("blobs").delete(id);
  await tx.done;
  notifyChange();
}

export type SendOutcome = { result: "done" } | { result: "retry"; error: string } | { result: "rejected"; error: string };
export type Sender = (op: OfflineOperation, blob: Blob | null) => Promise<SendOutcome>;

let flushing: Promise<FlushSummary> | null = null;

export interface FlushSummary {
  sent: number;
  failed: number;
  remaining: number;
}

/** Send pending operations oldest-first. Concurrent calls share one flush. */
export function flushQueue(send: Sender, businessId?: string): Promise<FlushSummary> {
  flushing ??= (async () => {
    const summary: FlushSummary = { sent: 0, failed: 0, remaining: 0 };
    try {
      for (const op of await listOperations(businessId)) {
        if (op.status === "failed") continue;
        let outcome: SendOutcome;
        try {
          outcome = await send(op, await getBlob(op.id));
        } catch (error) {
          outcome = { result: "retry", error: error instanceof Error ? error.message : "Network error" };
        }
        if (outcome.result === "done") {
          await removeOperation(op.id);
          summary.sent++;
          continue;
        }
        const database = await db();
        await database.put("operations", {
          ...op,
          attempts: op.attempts + 1,
          status: outcome.result === "rejected" ? "failed" : "pending",
          lastError: outcome.error,
        });
        if (outcome.result === "rejected") summary.failed++;
        else break; // still offline or server busy: keep order, stop here
      }
      summary.remaining = (await listOperations(businessId)).filter((o) => o.status === "pending").length;
      notifyChange();
      return summary;
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

/** Map an HTTP response to a queue outcome. */
export function outcomeFromResponse(res: Response, error = res.statusText): SendOutcome {
  if (res.ok) return { result: "done" };
  if (res.status === 408 || res.status === 425 || res.status === 429 || res.status >= 500) return { result: "retry", error };
  return { result: "rejected", error };
}

const CHANGE_EVENT = "stockpilot:offline-queue";
function notifyChange() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGE_EVENT));
}
export function onQueueChange(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}
