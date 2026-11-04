/**
 * Audit trail.
 *
 * Every mutation that changes money leaves a row here. Rules make audit logs
 * create-only — they can be written and read but never edited or deleted — so
 * the history of a disputed balance survives even a later correction.
 *
 * A failed audit write must not fail the mutation it describes: losing the note
 * is bad, losing the user's entry is worse. So callers fire and forget, and the
 * failure is logged rather than thrown.
 */

import { setDoc, serverTimestamp } from 'firebase/firestore';

import { randomId } from '@/lib/ids';
import type { AuditAction, AuditLog } from '@/types/models';

import { getDb } from './client';
import { auditLogDoc } from './paths';

export async function recordAudit(
  uid: string,
  entry: Pick<AuditLog, 'action' | 'entity' | 'entityId' | 'summary'>,
): Promise<void> {
  const db = getDb();
  if (!db) return;
  const id = randomId('log');
  try {
    await setDoc(auditLogDoc(db, uid, id), {
      action: entry.action satisfies AuditAction,
      entity: entry.entity,
      entityId: entry.entityId,
      summary: entry.summary.slice(0, 500),
      at: serverTimestamp(),
    });
  } catch (error) {
    if (import.meta.env.DEV) console.error('[work-ledger] audit write failed', error);
  }
}
