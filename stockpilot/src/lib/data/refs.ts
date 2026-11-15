import "server-only";
import type { CollectionReference, DocumentReference } from "firebase-admin/firestore";
import { db } from "@/lib/firebase/admin";
import type {
  BatchDoc, BusinessDoc, IntegrationDoc, InvitationDoc, MappingDoc, MemberDoc, MembershipDoc, MovementDoc, NotificationDoc,
  NotificationPrefsDoc, ProductDoc, PurchaseOrderDoc, ReviewItemDoc, SupplierDoc, SupplierProductDoc, SyncLogDoc,
} from "./model";

type Col<T> = CollectionReference<T>;
const col = <T>(path: string) => db().collection(path) as Col<T>;

/** Collections scoped to one business. businessId must come from a verified context. */
export function biz(businessId: string) {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(businessId)) throw new Error("Invalid business id");
  const root = `businesses/${businessId}`;
  return {
    doc: db().doc(root) as DocumentReference<BusinessDoc>,
    members: col<MemberDoc>(`${root}/members`),
    locations: col<{ name: string; address: string | null; isPrimary: boolean; createdAt: string }>(`${root}/locations`),
    categories: col<{ name: string; nameLower: string; createdAt: string }>(`${root}/categories`),
    products: col<ProductDoc>(`${root}/products`),
    batches: col<BatchDoc>(`${root}/batches`),
    movements: col<MovementDoc>(`${root}/movements`),
    suppliers: col<SupplierDoc>(`${root}/suppliers`),
    supplierProducts: col<SupplierProductDoc>(`${root}/supplierProducts`),
    priceHistory: col<{ supplierId: string; productId: string; productName: string; unitCost: number; recordedAt: string }>(`${root}/priceHistory`),
    purchaseOrders: col<PurchaseOrderDoc>(`${root}/purchaseOrders`),
    voiceSessions: col<Record<string, unknown>>(`${root}/voiceSessions`),
    photoAudits: col<Record<string, unknown>>(`${root}/photoAudits`),
    aiExtractions: col<Record<string, unknown>>(`${root}/aiExtractions`),
    reviewItems: col<ReviewItemDoc>(`${root}/reviewItems`),
    notifications: col<NotificationDoc>(`${root}/notifications`),
    notificationPrefs: col<NotificationPrefsDoc>(`${root}/notificationPrefs`),
    integrations: col<IntegrationDoc>(`${root}/integrations`),
    mappings: (provider: string) => col<MappingDoc>(`${root}/integrations/${provider}/mappings`),
    syncLogs: col<SyncLogDoc>(`${root}/syncLogs`),
    activityLogs: col<{ actorId: string | null; action: string; entityType: string | null; entityId: string | null; metadata: Record<string, unknown>; createdAt: string }>(`${root}/activityLogs`),
    counters: db().doc(`${root}/meta/counters`) as DocumentReference<{ purchaseOrder?: number }>,
  };
}

export const users = () => col<{ email: string | null; fullName: string | null; createdAt: string }>("users");
export const memberships = (uid: string) => col<MembershipDoc>(`users/${uid}/memberships`);
export const pushSubscriptions = (uid: string) => col<{ endpoint: string; p256dh: string; auth: string; createdAt: string }>(`users/${uid}/pushSubscriptions`);
export const invitations = () => col<InvitationDoc>("invitations");
export const oauthStates = () => col<{ businessId: string; provider: string; userId: string; shopDomain: string | null; expiresAt: string }>("oauthStates");
export const integrationSecrets = () => col<{ businessId: string; provider: string; accessToken: string; refreshToken: string | null; expiresAt: string | null; scopes: string | null; updatedAt: string }>("integrationSecrets");
export const webhookEvents = () => col<{ provider: string; eventId: string; eventType: string; businessId: string | null; status: string; error: string | null; receivedAt: string; processedAt: string | null }>("webhookEvents");
export const integrationAccounts = () => col<{ businessId: string; provider: string }>("integrationAccounts");
export const rateLimits = () => col<{ windowStart: number; count: number }>("rateLimits");

export const nowIso = () => new Date().toISOString();
