import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asService, asUser, createTestDatabase, createUser, key, q, type TestDb } from "./db-helpers";

let db: TestDb;
let ownerA: string, managerA: string, employeeA: string, employeeA2: string, ownerB: string;
let bizA: string, bizB: string;

const MOVE = `select public.apply_stock_movement(
  p_business_id => $1, p_product_id => $2, p_type => $3::public.movement_type, p_quantity => $4,
  p_idempotency_key => $5, p_batch_number => $6, p_expiry_date => $7::date, p_unit_cost => $8,
  p_batch_id => $9, p_observed_at => $10::timestamptz) as m`;

async function move(
  user: string,
  product: string,
  type: string,
  quantity: number,
  opts: { key?: string; batch?: string; expiry?: string; cost?: number; batchId?: string; observedAt?: string; biz?: string } = {},
) {
  const rows = await q<{ m: Record<string, unknown> }>(db.pool, user, MOVE, [
    opts.biz ?? bizA, product, type, quantity, opts.key ?? key(), opts.batch ?? null, opts.expiry ?? null,
    opts.cost ?? null, opts.batchId ?? null, opts.observedAt ?? null,
  ]);
  return rows[0].m;
}

async function createProduct(user: string, biz: string, name: string, extra: Record<string, unknown> = {}) {
  const fields = { business_id: biz, name, reorder_threshold: 10, cost_price: 2, selling_price: 4, ...extra };
  const cols = Object.keys(fields);
  const rows = await q<{ id: string }>(
    db.pool,
    user,
    `insert into public.products (${cols.join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")}) returning id`,
    Object.values(fields),
  );
  return rows[0].id;
}

async function quantity(product: string): Promise<number> {
  const { rows } = await db.pool.query(`select current_quantity from public.products where id = $1`, [product]);
  return Number(rows[0].current_quantity);
}

beforeAll(async () => {
  db = await createTestDatabase();
  ownerA = await createUser(db.pool, "owner-a@example.com", "Olivia Owner");
  managerA = await createUser(db.pool, "manager-a@example.com", "Manny Manager");
  employeeA = await createUser(db.pool, "employee-a@example.com", "Emma Employee");
  employeeA2 = await createUser(db.pool, "employee2-a@example.com", "Eli Employee");
  ownerB = await createUser(db.pool, "owner-b@example.com", "Bob Other");

  bizA = (await q<{ id: string }>(db.pool, ownerA, `select public.create_business('Corner Pharmacy', 'pharmacy') as id`))[0].id;
  bizB = (await q<{ id: string }>(db.pool, ownerB, `select public.create_business('Rival Hardware', 'hardware') as id`))[0].id;

  for (const [user, email, role] of [
    [managerA, "manager-a@example.com", "manager"],
    [employeeA, "employee-a@example.com", "employee"],
    [employeeA2, "employee2-a@example.com", "employee"],
  ] as const) {
    const token = (await q<{ t: string }>(db.pool, ownerA, `select public.create_invitation($1, $2, $3) as t`, [bizA, email, role]))[0].t;
    await q(db.pool, user, `select public.accept_invitation($1)`, [token]);
  }
}, 60_000);

afterAll(async () => {
  await db?.drop();
});

describe("tenancy and onboarding", () => {
  it("creates owner membership, primary location and profile", async () => {
    const members = await q(db.pool, ownerA, `select role from public.business_members where business_id = $1 order by role`, [bizA]);
    expect(members.map((m) => m.role)).toEqual(["owner", "manager", "employee", "employee"]);
    const loc = await q(db.pool, ownerA, `select name, is_primary from public.business_locations where business_id = $1`, [bizA]);
    expect(loc).toEqual([{ name: "Main store", is_primary: true }]);
    const prof = await q(db.pool, ownerA, `select full_name from public.profiles where id = $1`, [ownerA]);
    expect(prof[0].full_name).toBe("Olivia Owner");
  });

  it("rejects invitation tokens for the wrong email, and token reuse", async () => {
    const token = (await q<{ t: string }>(db.pool, ownerA, `select public.create_invitation($1, 'someone@example.com', 'employee') as t`, [bizA]))[0].t;
    await expect(q(db.pool, ownerB, `select public.accept_invitation($1)`, [token])).rejects.toThrow(/invitation_email_mismatch/);
    const someone = await createUser(db.pool, "someone@example.com");
    await q(db.pool, someone, `select public.accept_invitation($1)`, [token]);
    await expect(q(db.pool, someone, `select public.accept_invitation($1)`, [token])).rejects.toThrow(/invalid_invitation/);
    await q(db.pool, ownerA, `delete from public.business_members where user_id = $1`, [someone]);
  });

  it("only owners can invite, and nobody can invite an owner", async () => {
    await expect(q(db.pool, managerA, `select public.create_invitation($1, 'x@example.com', 'employee')`, [bizA])).rejects.toThrow(/forbidden/);
    await expect(q(db.pool, ownerA, `select public.create_invitation($1, 'x@example.com', 'owner')`, [bizA])).rejects.toThrow(/invalid_role/);
  });

  it("never removes the last owner", async () => {
    await expect(q(db.pool, ownerA, `update public.business_members set role = 'manager' where user_id = $1 and business_id = $2`, [ownerA, bizA]))
      .rejects.toThrow(/last_owner/);
    await expect(q(db.pool, ownerA, `delete from public.business_members where user_id = $1 and business_id = $2`, [ownerA, bizA]))
      .rejects.toThrow(/last_owner/);
  });
});

describe("business data isolation (RLS)", () => {
  let productA: string;
  beforeAll(async () => {
    productA = await createProduct(ownerA, bizA, "Children's Cough Syrup");
    await move(ownerA, productA, "receive", 5);
  });

  it("hides another tenant's rows on every table", async () => {
    for (const table of ["businesses", "products", "inventory_movements", "business_members", "business_locations", "notifications", "activity_logs"]) {
      const column = table === "businesses" ? "id" : "business_id";
      const rows = await q(db.pool, ownerB, `select 1 from public.${table} where ${column} = $1`, [bizA]);
      expect(rows, table).toHaveLength(0);
    }
    const found = await q(db.pool, ownerB, `select * from public.search_products($1, 'cough')`, [bizA]);
    expect(found).toHaveLength(0);
  });

  it("blocks cross-tenant writes and RPCs", async () => {
    await expect(createProduct(ownerB, bizA, "Injected")).rejects.toThrow(/row-level security/);
    await expect(move(ownerB, productA, "set_count", 0)).rejects.toThrow(/forbidden/);
    await expect(move(ownerB, productA, "set_count", 0, { biz: bizB })).rejects.toThrow(/product_not_found/);
    await expect(q(db.pool, ownerB, `select public.dashboard_summary($1)`, [bizA])).rejects.toThrow(/forbidden/);
    const updated = await q(db.pool, ownerB, `update public.products set name = 'pwned' where id = $1 returning id`, [productA]);
    expect(updated).toHaveLength(0);
  });

  it("rejects references to another tenant's rows", async () => {
    const supplierB = (await q<{ id: string }>(db.pool, ownerB, `insert into public.suppliers (business_id, name) values ($1, 'B Supplier') returning id`, [bizB]))[0].id;
    await expect(createProduct(ownerA, bizA, "Sneaky", { preferred_supplier_id: supplierB })).rejects.toThrow(/cross_tenant_reference/);
  });

  it("gives anonymous clients nothing", async () => {
    await expect(asAnon(db.pool, (c) => c.query(`select * from public.products`))).rejects.toThrow(/permission denied/);
    await expect(asAnon(db.pool, (c) => c.query(`select public.create_business('x')`))).rejects.toThrow(/permission denied/);
  });

  it("keeps the storage bucket namespaced by business", async () => {
    await expect(
      asUser(db.pool, ownerB, (c) => c.query(`insert into storage.objects (bucket_id, name) values ('inventory-media', $1)`, [`${bizA}/photo-audits/x.jpg`])),
    ).rejects.toThrow(/row-level security/);
    await asUser(db.pool, ownerA, (c) => c.query(`insert into storage.objects (bucket_id, name) values ('inventory-media', $1)`, [`${bizA}/photo-audits/x.jpg`]));
    const visible = await q(db.pool, ownerB, `select 1 from storage.objects`);
    expect(visible).toHaveLength(0);
  });
});

describe("permission restrictions", () => {
  it("stock columns and the ledger cannot be written directly", async () => {
    const p = await createProduct(ownerA, bizA, "Direct write test");
    await expect(q(db.pool, ownerA, `update public.products set current_quantity = 999 where id = $1`, [p])).rejects.toThrow(/permission denied/);
    await expect(createProduct(ownerA, bizA, "Qty on insert", { current_quantity: 50 })).rejects.toThrow(/permission denied/);
    await expect(
      q(db.pool, ownerA, `insert into public.inventory_movements (business_id, product_id, movement_type, source, quantity_before, quantity_after, quantity_change, idempotency_key) values ($1,$2,'receive','manual',0,5,5,'k-direct-1')`, [bizA, p]),
    ).rejects.toThrow(/permission denied/);
  });

  it("employees cannot manage the catalog or make corrections", async () => {
    await expect(createProduct(employeeA, bizA, "Employee product")).rejects.toThrow(/row-level security/);
    const p = await createProduct(managerA, bizA, "Manager product");
    await expect(move(employeeA, p, "correction", 3)).rejects.toThrow(/forbidden/);
    await expect(move(employeeA, p, "initial", 3)).rejects.toThrow(/forbidden/);
  });

  it("employees need approval for large adjustments, managers do not", async () => {
    const p = await createProduct(managerA, bizA, "AA Batteries", { unit: "pack" });
    await move(managerA, p, "receive", 40);
    await expect(move(employeeA, p, "receive", 200)).rejects.toThrow(/approval_required/);
    await expect(move(employeeA, p, "set_count", 2)).rejects.toThrow(/approval_required/); // -95%
    await move(employeeA, p, "set_count", 36); // small count change is fine
    await move(managerA, p, "set_count", 2);
    expect(await quantity(p)).toBe(2);
  });

  it("server-only functions reject end users", async () => {
    const p = await createProduct(ownerA, bizA, "System only");
    await expect(
      q(db.pool, ownerA, `select public.apply_stock_movement_system($1, $2, 'sale', 1, 'k-sys-0001', 'pos')`, [bizA, p]),
    ).rejects.toThrow(/permission denied/);
    await expect(q(db.pool, ownerA, `select public.check_rate_limit('x', 1, 60)`)).rejects.toThrow(/permission denied/);
    await expect(q(db.pool, ownerA, `select public.purge_business($1)`, [bizA])).rejects.toThrow(/permission denied/);
    await expect(move(ownerA, p, "receive", 1).then(() => q(db.pool, ownerA, MOVE.replace("p_batch_id => $9", "p_source => 'pos', p_batch_id => $9"), [bizA, p, "sale", 1, key(), null, null, null, null, null])))
      .rejects.toThrow(/reserved for the server/);
  });
});

describe("stock engine", () => {
  it("applies receive, sale and count with an exact audit trail", async () => {
    const p = await createProduct(ownerA, bizA, "Milk 1 gal", { unit: "gallon", reorder_threshold: 5 });
    const r = await move(ownerA, p, "receive", 12, { cost: 3 });
    expect(r).toMatchObject({ quantity_before: 0, quantity_after: 12, quantity_change: 12, duplicate: false });
    await move(ownerA, p, "sale", 2);
    const c = await move(ownerA, p, "set_count", 7);
    expect(c).toMatchObject({ quantity_before: 10, quantity_after: 7, quantity_change: -3, movement_type: "set_count" });
    expect(await quantity(p)).toBe(7);
    const ledger = await q(db.pool, ownerA, `select sum(quantity_change)::float as s from public.inventory_movements where product_id = $1`, [p]);
    expect(ledger[0].s).toBe(7);
  });

  it("is idempotent and rejects key reuse for other operations", async () => {
    const p = await createProduct(ownerA, bizA, "Idempotent product");
    const k = key("voice");
    await move(ownerA, p, "receive", 5, { key: k });
    const again = await move(ownerA, p, "receive", 5, { key: k });
    expect(again.duplicate).toBe(true);
    expect(await quantity(p)).toBe(5);
    await expect(move(ownerA, p, "sale", 1, { key: k })).rejects.toThrow(/idempotency_conflict/);
  });

  it("handles concurrent duplicate submissions exactly once", async () => {
    const p = await createProduct(ownerA, bizA, "Concurrent product");
    const k = key("offline");
    const results = await Promise.all(Array.from({ length: 5 }, () => move(ownerA, p, "receive", 3, { key: k })));
    expect(results.filter((r) => r.duplicate === false)).toHaveLength(1);
    expect(await quantity(p)).toBe(3);
  });

  it("never goes negative", async () => {
    const p = await createProduct(ownerA, bizA, "Scarce");
    await move(ownerA, p, "receive", 2);
    await expect(move(ownerA, p, "damage", 3)).rejects.toThrow(/insufficient_stock/);
    expect(await quantity(p)).toBe(2);
  });

  it("deducts sales First-Expired-First-Out across batches", async () => {
    const p = await createProduct(ownerA, bizA, "Yogurt", { track_expiry: true });
    await move(ownerA, p, "receive", 5, { batch: "LATE", expiry: "2030-06-01" });
    await move(ownerA, p, "receive", 4, { batch: "EARLY", expiry: "2030-01-01" });
    const sale = await move(ownerA, p, "sale", 6);
    const batches = await q(db.pool, ownerA, `select batch_number, quantity::float from public.inventory_batches where product_id = $1 order by expiry_date`, [p]);
    expect(batches).toEqual([{ batch_number: "EARLY", quantity: 0 }, { batch_number: "LATE", quantity: 3 }]);
    expect(sale.batch_allocations).toHaveLength(2);
  });

  it("records expiry against a named batch and values the loss", async () => {
    const p = await createProduct(ownerA, bizA, "Cetirizine 10mg", { cost_price: 5 });
    await move(ownerA, p, "receive", 10, { batch: "B1", expiry: "2020-01-01", cost: 5 });
    await move(ownerA, p, "receive", 10, { batch: "B2", expiry: "2031-01-01", cost: 5 });
    const b1 = (await q<{ id: string }>(db.pool, ownerA, `select id from public.inventory_batches where product_id = $1 and batch_number = 'B1'`, [p]))[0].id;
    const exp = await move(ownerA, p, "expire", 10, { batchId: b1 });
    expect(exp).toMatchObject({ batch_id: b1, quantity_change: -10, value_change: -50 });
    expect(await quantity(p)).toBe(10);
    await expect(move(ownerA, p, "expire", 1, { batchId: b1 })).rejects.toThrow(/insufficient_batch_stock/);
  });

  it("keeps batch totals within stock on losses and counts", async () => {
    const p = await createProduct(ownerA, bizA, "Bread");
    await move(ownerA, p, "receive", 6, { batch: "X", expiry: "2030-01-01" });
    await move(ownerA, p, "receive", 4); // unbatched
    await move(ownerA, p, "damage", 5); // consumes 4 unbatched first, then 1 from batch
    const [b] = await q(db.pool, ownerA, `select quantity::float from public.inventory_batches where product_id = $1`, [p]);
    expect(b.quantity).toBe(5);
    await move(ownerA, p, "set_count", 2);
    const [b2] = await q(db.pool, ownerA, `select quantity::float from public.inventory_batches where product_id = $1`, [p]);
    expect(b2.quantity).toBe(2);
  });

  it("refuses stale observations that predate newer stock changes", async () => {
    const p = await createProduct(ownerA, bizA, "Stale product");
    await move(ownerA, p, "receive", 10);
    await expect(move(ownerA, p, "set_count", 3, { observedAt: new Date(Date.now() - 3600_000).toISOString() })).rejects.toThrow(/stale_observation/);
    expect(await quantity(p)).toBe(10);
  });

  it("maintains weighted average cost on receipt", async () => {
    const p = await createProduct(ownerA, bizA, "Avg cost", { cost_price: 0 });
    await move(ownerA, p, "receive", 10, { cost: 2 });
    await move(ownerA, p, "receive", 10, { cost: 4 });
    const [row] = await q(db.pool, ownerA, `select cost_price::float from public.products where id = $1`, [p]);
    expect(row.cost_price).toBe(3);
  });

  it("raises low-stock and out-of-stock alerts once per day", async () => {
    const p = await createProduct(managerA, bizA, "Alerting product", { reorder_threshold: 10 });
    await move(managerA, p, "receive", 12);
    await move(managerA, p, "sale", 5);
    await move(managerA, p, "receive", 10);
    await move(managerA, p, "sale", 12);
    await move(managerA, p, "sale", 5);
    const low = await q(db.pool, managerA, `select type from public.notifications where link = $1 order by type`, [`/inventory/${p}`]);
    expect(low.map((n) => n.type)).toEqual(["low_stock", "out_of_stock"]);
    const empNotes = await q(db.pool, employeeA, `select 1 from public.notifications where link = $1`, [`/inventory/${p}`]);
    expect(empNotes).toHaveLength(0);
  });

  it("makes the movement ledger immutable, even for the service role", async () => {
    const p = await createProduct(ownerA, bizA, "Immutable");
    const m = await move(ownerA, p, "receive", 1);
    await expect(asService(db.pool, (c) => c.query(`update public.inventory_movements set quantity_change = 100 where id = $1`, [m.id]))).rejects.toThrow(/immutable_record/);
    await expect(asService(db.pool, (c) => c.query(`delete from public.inventory_movements where id = $1`, [m.id]))).rejects.toThrow(/immutable_record/);
    await expect(q(db.pool, ownerA, `delete from public.products where id = $1`, [p])).rejects.toThrow(/foreign key/);
  });

  it("lets POS sales clamp at zero instead of failing", async () => {
    const p = await createProduct(ownerA, bizA, "POS item");
    await move(ownerA, p, "receive", 1);
    const r = await asService(db.pool, (c) =>
      c.query(`select public.apply_stock_movement_system($1, $2, 'sale', 3, 'square:evt-1', 'pos') as m`, [bizA, p]),
    );
    expect(r.rows[0].m).toMatchObject({ quantity_after: 0, actor_id: null, source: "pos" });
  });
});

describe("AI review queue", () => {
  async function proposal(user: string, product: string, requiresRole = "employee", qty = 3) {
    const voice = (await q<{ id: string }>(db.pool, user, `insert into public.voice_sessions (business_id, user_id) values ($1, $2) returning id`, [bizA, user]))[0].id;
    const ext = (await q<{ id: string }>(db.pool, user,
      `insert into public.ai_extractions (business_id, source_type, voice_session_id, provider, prompt_version, is_valid, created_by) values ($1, 'voice', $2, 'local', 'v1', true, $3) returning id`,
      [bizA, voice, user]))[0].id;
    return (await q<{ id: string }>(db.pool, user,
      `insert into public.ai_review_queue (business_id, extraction_id, source_type, action_index, proposed, matched_product_id, movement_type, base_quantity, requires_role, ai_confidence, created_by)
       values ($1, $2, 'voice', 0, '{}'::jsonb, $3, 'set_count', $4, $5::public.member_role, 0.9, $6) returning id`,
      [bizA, ext, product, qty, requiresRole, user]))[0].id;
  }
  const APPLY = `select public.apply_review_item($1, $2, $3::public.movement_type, $4) as m`;

  it("applies an employee's own low-risk item exactly once", async () => {
    const p = await createProduct(managerA, bizA, "Review low risk");
    await move(managerA, p, "receive", 4);
    const item = await proposal(employeeA, p);
    const m = (await q(db.pool, employeeA, APPLY, [item, p, "set_count", 3]))[0].m;
    expect(m).toMatchObject({ source: "voice", review_item_id: item, ai_confidence: 0.9, approved_by: null });
    const again = (await q(db.pool, employeeA, APPLY, [item, p, "set_count", 3]))[0].m;
    expect(again.duplicate).toBe(true);
    const [row] = await q(db.pool, employeeA, `select status, was_edited from public.ai_review_queue where id = $1`, [item]);
    expect(row).toEqual({ status: "applied", was_edited: false });
  });

  it("routes high-risk items to managers and records the approver", async () => {
    const p = await createProduct(managerA, bizA, "Review high risk");
    await move(managerA, p, "receive", 100);
    const item = await proposal(employeeA, p, "manager", 10);
    await expect(q(db.pool, employeeA, APPLY, [item, p, "set_count", 10])).rejects.toThrow(/approval_required/);
    const notified = await q(db.pool, managerA, `select 1 from public.notifications where type = 'ai_review' and dedupe_key = $1`, [`ai_review:${item}`]);
    expect(notified).toHaveLength(1);
    const m = (await q(db.pool, managerA, APPLY, [item, p, "set_count", 12]))[0].m;
    expect(m).toMatchObject({ approved_by: managerA, approval_status: "approved", quantity_after: 12 });
    const [row] = await q(db.pool, managerA, `select was_edited from public.ai_review_queue where id = $1`, [item]);
    expect(row.was_edited).toBe(true);
  });

  it("stops employees confirming each other's audits and hides them", async () => {
    const p = await createProduct(managerA, bizA, "Review other");
    await move(managerA, p, "receive", 4);
    const item = await proposal(employeeA, p);
    expect(await q(db.pool, employeeA2, `select 1 from public.ai_review_queue where id = $1`, [item])).toHaveLength(0);
    await expect(q(db.pool, employeeA2, APPLY, [item, p, "set_count", 3])).rejects.toThrow(/forbidden/);
    await q(db.pool, employeeA, `select public.reject_review_item($1, 'wrong product')`, [item]);
    await expect(q(db.pool, employeeA, APPLY, [item, p, "set_count", 3])).rejects.toThrow(/review_item_closed/);
  });

  it("cannot insert pre-approved items", async () => {
    const p = await createProduct(managerA, bizA, "Review forged");
    await expect(
      q(db.pool, employeeA, `insert into public.ai_review_queue (business_id, extraction_id, source_type, action_index, proposed, status, created_by) select $1, id, 'voice', 5, '{}', 'applied', $2 from public.ai_extractions limit 1`, [bizA, employeeA]),
    ).rejects.toThrow(/row-level security/);
    void p;
  });
});

describe("purchase orders", () => {
  it("runs the approval and receiving lifecycle with owner-only approval", async () => {
    const supplier = (await q<{ id: string }>(db.pool, managerA, `insert into public.suppliers (business_id, name, email) values ($1, 'Acme Wholesale', 'orders@acme.test') returning id`, [bizA]))[0].id;
    const p = await createProduct(managerA, bizA, "PO product", { cost_price: 1.5 });
    const items = JSON.stringify([{ product_id: p, quantity: 24, unit_cost: 1.5 }]);
    const po = (await q<{ id: string }>(db.pool, managerA, `select public.create_purchase_order($1, $2, $3::jsonb) as id`, [bizA, supplier, items]))[0].id;

    const [order] = await q(db.pool, managerA, `select po_number, status, subtotal::float from public.purchase_orders where id = $1`, [po]);
    expect(order).toEqual({ po_number: "PO-00001", status: "draft", subtotal: 36 });
    expect(await q(db.pool, employeeA, `select 1 from public.purchase_orders where id = $1`, [po])).toHaveLength(0);

    await expect(q(db.pool, managerA, `select public.transition_purchase_order($1, 'approve')`, [po])).rejects.toThrow(/forbidden/);
    await expect(q(db.pool, managerA, `select public.transition_purchase_order($1, 'mark_sent', 'email')`, [po])).rejects.toThrow(/only approved/);
    await q(db.pool, ownerA, `select public.transition_purchase_order($1, 'approve')`, [po]);
    const [line] = await q<{ id: string }>(db.pool, managerA, `select id from public.purchase_order_items where purchase_order_id = $1`, [po]);
    await expect(q(db.pool, managerA, `update public.purchase_order_items set quantity = 1000 where id = $1`, [line.id])).rejects.toThrow(/purchase_order_locked/);
    await q(db.pool, managerA, `select public.transition_purchase_order($1, 'mark_sent', 'email')`, [po]);

    await q(db.pool, managerA, `select public.receive_purchase_order_item($1, 10, 'delivery-1')`, [line.id]);
    await q(db.pool, managerA, `select public.receive_purchase_order_item($1, 10, 'delivery-1')`, [line.id]); // replay
    expect((await q(db.pool, managerA, `select status from public.purchase_orders where id = $1`, [po]))[0].status).toBe("partially_received");
    await q(db.pool, managerA, `select public.receive_purchase_order_item($1, 14, 'delivery-2', 'LOT9', '2031-01-01')`, [line.id]);
    expect((await q(db.pool, managerA, `select status from public.purchase_orders where id = $1`, [po]))[0].status).toBe("received");
    expect(await quantity(p)).toBe(24);
  });
});

describe("dashboard and reports", () => {
  it("computes the dashboard from real records and hides money from employees", async () => {
    const owner = (await q(db.pool, ownerA, `select public.dashboard_summary($1) as d`, [bizA]))[0].d;
    expect(owner.total_products).toBeGreaterThan(5);
    expect(typeof owner.inventory_value).toBe("number");
    expect(owner.trend).toHaveLength(30);
    expect(owner.trend.at(-1).units).toBe(owner.total_units);
    const emp = (await q(db.pool, employeeA, `select public.dashboard_summary($1) as d`, [bizA]))[0].d;
    expect(emp.inventory_value).toBeNull();
  });

  it("runs every report for managers and refuses employees", async () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const report of ["daily_changes", "weekly_summary", "monthly_valuation", "expired_loss", "damaged_loss", "shrinkage", "stockout_frequency", "reorder_history", "employee_activity", "ai_accuracy"]) {
      const rows = (await q(db.pool, managerA, `select public.inventory_report($1, $2, $3::date - 30, $3::date) as r`, [bizA, report, today]))[0].r;
      expect(Array.isArray(rows), report).toBe(true);
    }
    const expired = (await q(db.pool, managerA, `select public.inventory_report($1, 'expired_loss', $2::date - 1, $2::date) as r`, [bizA, today]))[0].r;
    expect(expired.find((r: { product: string }) => r.product === "Cetirizine 10mg")).toMatchObject({ units: 10, loss_value: 50 });
    await expect(q(db.pool, employeeA, `select public.inventory_report($1, 'shrinkage', $2::date - 1, $2::date)`, [bizA, today])).rejects.toThrow(/forbidden/);
  });

  it("sweeps expiring batches into deduplicated alerts", async () => {
    const p = await createProduct(ownerA, bizA, "Fresh juice", { track_expiry: true });
    const soon = new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10);
    await move(ownerA, p, "receive", 6, { batch: "J1", expiry: soon });
    const run = () => asService(db.pool, (c) => c.query(`select public.run_expiry_alerts() as n`));
    await run();
    await run();
    const alerts = await q(db.pool, ownerA, `select type, title from public.notifications where type in ('expired','expiring')`);
    expect(alerts).toContainEqual({ type: "expiring", title: "Fresh juice expires soon" });
    expect(await q(db.pool, employeeA, `select 1 from public.notifications where type = 'expiring'`)).toHaveLength(0);
    const dupes = await q(db.pool, ownerA, `select dedupe_key, count(*) from public.notifications where user_id = $1 group by 1 having count(*) > 1`, [ownerA]);
    expect(dupes).toHaveLength(0);
  });
});

describe("platform utilities", () => {
  it("rate limits per key within a window", async () => {
    const results = await asService(db.pool, async (c) => {
      const out: boolean[] = [];
      for (let i = 0; i < 4; i++) out.push((await c.query(`select public.check_rate_limit('ai:user1', 3, 60) as ok`)).rows[0].ok);
      return out;
    });
    expect(results).toEqual([true, true, true, false]);
  });

  it("purges a tenant completely, ledgers included", async () => {
    const throwaway = await createUser(db.pool, "temp-owner@example.com");
    const biz = (await q<{ id: string }>(db.pool, throwaway, `select public.create_business('Temp Shop') as id`))[0].id;
    const p = await createProduct(throwaway, biz, "Temp product");
    await move(throwaway, p, "receive", 3, { biz });
    await asService(db.pool, (c) => c.query(`select public.purge_business($1)`, [biz]));
    const { rows } = await db.pool.query(`select (select count(*) from public.inventory_movements where business_id = $1)::int as m, (select count(*) from public.businesses where id = $1)::int as b`, [biz]);
    expect(rows[0]).toEqual({ m: 0, b: 0 });
  });
});

describe("read views", () => {
  it("respect RLS through security_invoker", async () => {
    const own = await q(db.pool, ownerA, `select count(*)::int as n from public.product_overview`);
    expect(own[0].n).toBeGreaterThan(0);
    const other = await q(db.pool, ownerB, `select count(*)::int as n from public.product_overview where business_id = $1`, [bizA]);
    expect(other[0].n).toBe(0);
    const batches = await q(db.pool, ownerB, `select count(*)::int as n from public.expiring_batches where business_id = $1`, [bizA]);
    expect(batches[0].n).toBe(0);
  });

  it("derives stock status", async () => {
    const rows = await q(db.pool, ownerA, `select stock_status, count(*)::int from public.product_overview where business_id = $1 group by 1`, [bizA]);
    expect(rows.map((r) => r.stock_status).sort()).toEqual(expect.arrayContaining(["out_of_stock"]));
  });
});
