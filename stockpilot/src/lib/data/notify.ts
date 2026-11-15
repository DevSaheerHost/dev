import "server-only";
import { hashId } from "@/lib/firebase/ids";
import type { MemberRole } from "@/lib/domain/types";
import type { NotificationDoc, NotificationType } from "./model";
import { biz, nowIso } from "./refs";

const RANK: Record<MemberRole, number> = { employee: 1, manager: 2, owner: 3 };

/**
 * Fan a notification out to active members at or above minRole. Each
 * (user, dedupeKey) pair is written once — repeated events don't spam.
 */
export async function notify(
  businessId: string,
  n: { type: NotificationType; severity: NotificationDoc["severity"]; title: string; body?: string | null; link?: string | null; dedupeKey: string; minRole?: MemberRole },
): Promise<void> {
  const ref = biz(businessId);
  const members = await ref.members.where("status", "==", "active").get();
  const min = RANK[n.minRole ?? "manager"];
  await Promise.all(
    members.docs
      .filter((m) => RANK[m.data().role] >= min)
      .map((m) =>
        ref.notifications
          .doc(hashId(m.id, n.dedupeKey))
          .create({
            userId: m.id, type: n.type, severity: n.severity, title: n.title.slice(0, 200), body: n.body?.slice(0, 1000) ?? null,
            link: n.link && /^\/[A-Za-z0-9/_\-?=&.]*$/.test(n.link) ? n.link : null,
            readAt: null, emailSentAt: null, pushSentAt: null, whatsappSentAt: null, createdAt: nowIso(),
          })
          .catch((e: { code?: number }) => {
            if (e.code !== 6) throw e; // 6 = ALREADY_EXISTS → duplicate, ignore
          }),
      ),
  );
}

export async function logActivity(businessId: string, actorId: string | null, action: string, entityType: string | null, entityId: string | null, metadata: Record<string, unknown> = {}) {
  await biz(businessId).activityLogs.add({ actorId, action, entityType, entityId, metadata, createdAt: nowIso() });
}
