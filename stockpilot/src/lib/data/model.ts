/**
 * Firestore document shapes. Everything a business owns lives under
 * businesses/{businessId}/... so tenant scoping is structural: every query
 * starts from the caller's verified business id.
 *
 *   users/{uid}                                  profile
 *   users/{uid}/memberships/{businessId}         membership index (mirror)
 *   users/{uid}/pushSubscriptions/{id}
 *   invitations/{sha256(token)}                  single-use invites
 *   oauthStates/{sha256(state)}, rateLimits/{id}, webhookEvents/{id}, integrationSecrets/{id}
 *   businesses/{bid}
 *     members/{uid}                              source of truth for roles
 *     locations, categories, products, batches, movements (append-only),
 *     suppliers, supplierProducts, priceHistory, purchaseOrders,
 *     voiceSessions, photoAudits, aiExtractions, reviewItems,
 *     notifications, notificationPrefs/{uid}, integrations/{provider},
 *     integrations/{provider}/mappings, syncLogs, activityLogs, meta/counters
 *
 * All timestamps are ISO-8601 UTC strings.
 */
import type { MemberRole, MovementSource, MovementType } from "@/lib/domain/types";
import type { StockUnit } from "@/lib/domain/units";

export interface BusinessDoc {
  name: string;
  businessType: string;
  currency: string;
  timezone: string;
  largeAdjustmentUnits: number;
  largeAdjustmentPercent: number;
  expiryWarningDays: number;
  createdBy: string;
  createdAt: string;
}

export interface MemberDoc {
  uid: string;
  role: MemberRole;
  status: "active" | "disabled";
  email: string | null;
  fullName: string | null;
  createdAt: string;
}

export interface MembershipDoc {
  businessId: string;
  businessName: string;
  role: MemberRole;
  status: "active" | "disabled";
}

export interface InvitationDoc {
  businessId: string;
  businessName: string;
  email: string;
  role: Exclude<MemberRole, "owner">;
  invitedBy: string;
  expiresAt: string;
  acceptedAt: string | null;
  acceptedBy: string | null;
  createdAt: string;
}

export interface VariantDoc {
  id: string;
  name: string;
  unit: StockUnit;
  conversionFactor: number;
  sku: string | null;
  barcode: string | null;
}

export interface ProductDoc {
  name: string;
  nameLower: string;
  sku: string | null;
  skuLower: string | null;
  barcode: string | null;
  brand: string | null;
  categoryId: string | null;
  categoryName: string | null;
  description: string | null;
  color: string | null;
  packageSize: string | null;
  synonyms: string[];
  costPrice: number;
  sellingPrice: number;
  quantity: number;
  unit: StockUnit;
  reorderThreshold: number;
  reorderQuantity: number | null;
  storageLocation: string | null;
  locationId: string | null;
  preferredSupplierId: string | null;
  trackExpiry: boolean;
  variants: VariantDoc[];
  lastCountedAt: string | null;
  lastMovementAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BatchDoc {
  productId: string;
  batchNumber: string | null;
  expiryDate: string | null;
  quantity: number;
  unitCost: number | null;
  locationId: string | null;
  receivedAt: string;
  updatedAt: string;
}

export interface MovementDoc {
  productId: string;
  productName: string;
  unit: StockUnit;
  batchId: string | null;
  toLocationId: string | null;
  auditId: string | null;
  type: MovementType;
  source: MovementSource;
  quantityBefore: number;
  quantityAfter: number;
  quantityChange: number;
  inputQuantity: number | null;
  inputUnit: string | null;
  allocations: { batchId: string | null; quantity: number }[];
  unitCost: number;
  valueChange: number;
  reason: string | null;
  actorId: string | null;
  actorName: string | null;
  aiConfidence: number | null;
  approvedBy: string | null;
  approvedByName: string | null;
  reviewItemId: string | null;
  idempotencyKey: string;
  externalRef: string | null;
  observedAt: string;
  createdAt: string;
}

export interface SupplierDoc {
  name: string;
  nameLower: string;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  whatsappNumber: string | null;
  address: string | null;
  paymentTerms: string | null;
  notes: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierProductDoc {
  supplierId: string;
  productId: string;
  supplierSku: string | null;
  unitCost: number;
  packSize: number;
  leadTimeDays: number | null;
  updatedAt: string;
}

export interface PurchaseOrderLine {
  id: string;
  productId: string;
  productName: string;
  unit: StockUnit;
  sku: string | null;
  quantity: number;
  unitCost: number;
  receivedQuantity: number;
}

export type PurchaseOrderStatus = "draft" | "approved" | "sent" | "partially_received" | "received" | "cancelled";

export interface PurchaseOrderDoc {
  poNumber: string;
  supplierId: string;
  supplierName: string;
  status: PurchaseOrderStatus;
  notes: string | null;
  expectedDate: string | null;
  lines: PurchaseOrderLine[];
  subtotal: number;
  generatedByAi: boolean;
  createdBy: string;
  approvedBy: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  sentVia: "email" | "whatsapp" | "manual" | null;
  receipts: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ReviewItemDoc {
  extractionId: string;
  sourceType: "voice" | "photo";
  voiceSessionId: string | null;
  photoAuditId: string | null;
  imagePath: string | null;
  actionIndex: number;
  proposed: Record<string, unknown>;
  spokenProduct: string;
  evidence: string;
  matchedProductId: string | null;
  matchConfidence: number | null;
  matchCandidates: { productId: string; name: string; score: number; reasons: string[]; unit?: string | null; currentQuantity?: number | null }[];
  aiConfidence: number;
  movementType: MovementType | null;
  inputQuantity: number | null;
  inputUnit: string | null;
  baseQuantity: number | null;
  quantityKind: "confirmed" | "visible" | "estimated";
  expiryDate: string | null;
  batchNumber: string | null;
  batchId: string | null;
  warnings: string[];
  riskLevel: "low" | "medium" | "high";
  requiresRole: MemberRole;
  status: "pending" | "needs_clarification" | "applied" | "rejected" | "superseded";
  clarificationQuestion: string | null;
  wasEdited: boolean;
  reviewerId: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  appliedMovementId: string | null;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
}

export type NotificationType = "low_stock" | "out_of_stock" | "expiring" | "expired" | "sync_failed" | "po_pending" | "ai_review" | "system";

export interface NotificationDoc {
  userId: string;
  type: NotificationType;
  severity: "info" | "warning" | "critical";
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  emailSentAt: string | null;
  pushSentAt: string | null;
  whatsappSentAt: string | null;
  createdAt: string;
}

export interface NotificationPrefsDoc {
  emailEnabled: boolean;
  pushEnabled: boolean;
  whatsappEnabled: boolean;
  whatsappNumber: string | null;
  types: Record<string, boolean>;
  updatedAt: string;
}

export interface IntegrationDoc {
  provider: "square" | "shopify" | "clover";
  status: "not_connected" | "connected" | "error" | "disconnected";
  externalAccountId: string | null;
  shopDomain: string | null;
  conflictPolicy: "newest_wins" | "pos" | "stockpilot";
  syncEnabled: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
  connectedBy: string | null;
  updatedAt: string;
}

export interface MappingDoc {
  productId: string | null;
  externalItemId: string;
  externalVariantId: string;
  externalSku: string | null;
  externalName: string | null;
  lastExternalQuantity: number | null;
  lastExternalUpdatedAt: string | null;
  updatedAt: string;
}

export interface SyncLogDoc {
  provider: string;
  direction: "pull" | "push" | "webhook";
  status: "running" | "success" | "partial" | "failed" | "conflict" | "skipped";
  itemsProcessed: number;
  conflicts: number;
  error: string | null;
  attempt: number;
  nextRetryAt: string | null;
  details: Record<string, unknown>;
  triggeredBy: string | null;
  createdAt: string;
  finishedAt: string | null;
}
