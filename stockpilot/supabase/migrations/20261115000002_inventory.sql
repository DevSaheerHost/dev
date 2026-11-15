-- StockPilot AI — Inventory core: catalog, suppliers, batches, immutable movements.
--
-- Stock invariants
--   * products.current_quantity is ONLY changed by app.apply_stock_movement_internal.
--     Clients have no INSERT/UPDATE privilege on that column.
--   * Quantities are stored in the product's base unit.
--   * sum(active batch quantities) <= products.current_quantity. Anything above
--     the batch total is "unbatched" stock.
--   * Sales and expiries consume batches First-Expired-First-Out (FEFO).
--   * Other losses (damage, missing, counts) consume unbatched stock first and
--     only trim batches FEFO when needed to keep the invariant above.
--   * A named batch is always deducted from that batch.
--   * Every change writes one immutable inventory_movements row; a repeated
--     idempotency key returns the original movement instead of applying twice.

create type public.stock_unit as enum
  ('piece', 'box', 'pack', 'bottle', 'kilogram', 'gram', 'liter', 'milliliter', 'gallon', 'case');

create type public.movement_type as enum (
  'initial',    -- opening balance
  'receive',    -- stock arrived (delivery / PO)
  'sale',       -- sold
  'return',     -- customer return back into stock
  'set_count',  -- physical count: quantity becomes the counted value
  'damage',     -- damaged, removed from sellable stock
  'expire',     -- expired, removed from sellable stock
  'missing',    -- shrinkage / theft / unexplained loss
  'correction', -- signed manual correction
  'transfer'    -- moved between locations (total unchanged)
);

create type public.movement_source as enum
  ('manual', 'voice', 'photo', 'pos', 'purchase', 'import', 'system');

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------
create table public.product_categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, name)
);
create trigger product_categories_updated_at before update on public.product_categories
  for each row execute function app.set_updated_at();

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  contact_person text check (char_length(contact_person) <= 120),
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text check (char_length(phone) <= 40),
  whatsapp_number text check (whatsapp_number is null or whatsapp_number ~ '^\+?[0-9]{7,15}$'),
  address text check (char_length(address) <= 500),
  payment_terms text check (char_length(payment_terms) <= 120),
  notes text check (char_length(notes) <= 2000),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index suppliers_business_idx on public.suppliers (business_id) where archived_at is null;
create trigger suppliers_updated_at before update on public.suppliers
  for each row execute function app.set_updated_at();

create table public.products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  location_id uuid references public.business_locations (id) on delete set null,
  category_id uuid references public.product_categories (id) on delete set null,
  preferred_supplier_id uuid references public.suppliers (id) on delete set null,
  name text not null check (char_length(name) between 1 and 200),
  sku text check (char_length(sku) <= 64),
  barcode text check (barcode is null or barcode ~ '^[0-9A-Za-z\-]{4,64}$'),
  brand text check (char_length(brand) <= 120),
  description text check (char_length(description) <= 2000),
  color text check (char_length(color) <= 40),
  package_size text check (char_length(package_size) <= 60),
  synonyms text[] not null default '{}' check (cardinality(synonyms) <= 30),
  cost_price numeric(12,2) not null default 0 check (cost_price >= 0),
  selling_price numeric(12,2) not null default 0 check (selling_price >= 0),
  current_quantity numeric(14,3) not null default 0 check (current_quantity >= 0),
  unit public.stock_unit not null default 'piece',
  reorder_threshold numeric(14,3) not null default 0 check (reorder_threshold >= 0),
  reorder_quantity numeric(14,3) check (reorder_quantity is null or reorder_quantity > 0),
  storage_location text check (char_length(storage_location) <= 120),
  image_path text check (char_length(image_path) <= 300),
  track_expiry boolean not null default false,
  last_counted_at timestamptz,
  last_movement_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index products_business_sku_uniq on public.products (business_id, lower(sku))
  where sku is not null and archived_at is null;
create unique index products_business_barcode_uniq on public.products (business_id, barcode)
  where barcode is not null and archived_at is null;
create index products_business_idx on public.products (business_id) where archived_at is null;
create index products_name_trgm on public.products using gin (name extensions.gin_trgm_ops);
create index products_low_stock_idx on public.products (business_id, current_quantity, reorder_threshold)
  where archived_at is null;
create trigger products_updated_at before update on public.products
  for each row execute function app.set_updated_at();

-- Variants are alternate sellable/receivable packagings of a product
-- (e.g. "Case of 24"). conversion_factor = base units contained in ONE variant.
-- They are the only source of package-unit conversions: a "case" is never
-- assumed to equal any number of pieces unless a variant says so.
create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  sku text check (char_length(sku) <= 64),
  barcode text check (barcode is null or barcode ~ '^[0-9A-Za-z\-]{4,64}$'),
  unit public.stock_unit not null,
  conversion_factor numeric(14,4) not null check (conversion_factor > 0),
  selling_price numeric(12,2) check (selling_price is null or selling_price >= 0),
  attributes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, unit, name)
);
create index product_variants_product_idx on public.product_variants (product_id);
create unique index product_variants_barcode_uniq on public.product_variants (business_id, barcode)
  where barcode is not null;
create trigger product_variants_updated_at before update on public.product_variants
  for each row execute function app.set_updated_at();

create table public.supplier_products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  supplier_sku text check (char_length(supplier_sku) <= 64),
  unit_cost numeric(12,2) not null default 0 check (unit_cost >= 0),
  pack_size numeric(14,3) not null default 1 check (pack_size > 0),
  lead_time_days integer check (lead_time_days between 0 and 365),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (supplier_id, product_id)
);
create index supplier_products_product_idx on public.supplier_products (product_id);
create trigger supplier_products_updated_at before update on public.supplier_products
  for each row execute function app.set_updated_at();

create table public.supplier_price_history (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  unit_cost numeric(12,2) not null,
  recorded_at timestamptz not null default now()
);
create index supplier_price_history_idx on public.supplier_price_history (supplier_id, product_id, recorded_at desc);
create trigger supplier_price_history_immutable before update or delete on public.supplier_price_history
  for each row execute function app.prevent_mutation();

create or replace function app.track_supplier_price()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.unit_cost is distinct from old.unit_cost then
    insert into public.supplier_price_history (business_id, supplier_id, product_id, unit_cost)
    values (new.business_id, new.supplier_id, new.product_id, new.unit_cost);
  end if;
  return new;
end;
$$;
create trigger supplier_products_price_history after insert or update on public.supplier_products
  for each row execute function app.track_supplier_price();

-- Cross-tenant reference guard: referenced rows must belong to the same business.
create or replace function app.assert_same_business()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'products' then
    if new.category_id is not null and not exists
         (select 1 from public.product_categories where id = new.category_id and business_id = new.business_id)
       or new.preferred_supplier_id is not null and not exists
         (select 1 from public.suppliers where id = new.preferred_supplier_id and business_id = new.business_id)
       or new.location_id is not null and not exists
         (select 1 from public.business_locations where id = new.location_id and business_id = new.business_id) then
      raise exception 'cross_tenant_reference' using errcode = '42501';
    end if;
  elsif tg_table_name in ('product_variants', 'inventory_batches') then
    if not exists (select 1 from public.products where id = new.product_id and business_id = new.business_id) then
      raise exception 'cross_tenant_reference' using errcode = '42501';
    end if;
  elsif tg_table_name = 'supplier_products' then
    if not exists (select 1 from public.products where id = new.product_id and business_id = new.business_id)
       or not exists (select 1 from public.suppliers where id = new.supplier_id and business_id = new.business_id) then
      raise exception 'cross_tenant_reference' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger products_same_business before insert or update on public.products
  for each row execute function app.assert_same_business();
create trigger product_variants_same_business before insert or update on public.product_variants
  for each row execute function app.assert_same_business();
create trigger supplier_products_same_business before insert or update on public.supplier_products
  for each row execute function app.assert_same_business();

-- ---------------------------------------------------------------------------
-- Batches, audits and movements
-- ---------------------------------------------------------------------------
create table public.inventory_batches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  product_id uuid not null references public.products (id),
  location_id uuid references public.business_locations (id) on delete set null,
  batch_number text check (char_length(batch_number) <= 64),
  expiry_date date,
  quantity numeric(14,3) not null default 0 check (quantity >= 0),
  unit_cost numeric(12,2) check (unit_cost is null or unit_cost >= 0),
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index inventory_batches_identity_uniq on public.inventory_batches
  (product_id, coalesce(batch_number, ''), coalesce(expiry_date, 'infinity'::date));
create index inventory_batches_expiry_idx on public.inventory_batches (business_id, expiry_date)
  where quantity > 0;
create trigger inventory_batches_updated_at before update on public.inventory_batches
  for each row execute function app.set_updated_at();
create trigger inventory_batches_same_business before insert or update on public.inventory_batches
  for each row execute function app.assert_same_business();

create table public.inventory_audits (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  location_id uuid references public.business_locations (id) on delete set null,
  started_by uuid not null references auth.users (id) on delete restrict,
  source text not null default 'voice' check (source in ('voice', 'photo', 'manual', 'mixed')),
  status text not null default 'in_progress' check (status in ('in_progress', 'completed', 'cancelled')),
  notes text check (char_length(notes) <= 2000),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index inventory_audits_business_idx on public.inventory_audits (business_id, started_at desc);
create trigger inventory_audits_updated_at before update on public.inventory_audits
  for each row execute function app.set_updated_at();

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  product_id uuid not null references public.products (id),
  batch_id uuid references public.inventory_batches (id),
  location_id uuid references public.business_locations (id) on delete set null,
  to_location_id uuid references public.business_locations (id) on delete set null,
  audit_id uuid references public.inventory_audits (id) on delete set null,
  movement_type public.movement_type not null,
  source public.movement_source not null,
  quantity_before numeric(14,3) not null,
  quantity_after numeric(14,3) not null,
  quantity_change numeric(14,3) not null,
  -- What the person/system actually said, before unit conversion.
  input_quantity numeric(14,3),
  input_unit text check (char_length(input_unit) <= 32),
  batch_allocations jsonb not null default '[]'::jsonb,
  unit_cost numeric(12,2) not null default 0,
  value_change numeric(14,2) not null default 0,
  reason text check (char_length(reason) <= 500),
  actor_id uuid references auth.users (id) on delete set null,
  ai_confidence numeric(4,3) check (ai_confidence is null or ai_confidence between 0 and 1),
  approval_status text not null default 'not_required'
    check (approval_status in ('not_required', 'approved')),
  approved_by uuid references auth.users (id) on delete set null,
  review_item_id uuid,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  external_ref text check (char_length(external_ref) <= 200),
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (business_id, idempotency_key),
  check (quantity_after = quantity_before + quantity_change)
);
create index inventory_movements_business_created_idx
  on public.inventory_movements (business_id, created_at desc);
create index inventory_movements_product_idx on public.inventory_movements (product_id, created_at desc);
create index inventory_movements_type_idx on public.inventory_movements (business_id, movement_type, created_at desc);
create trigger inventory_movements_immutable before update or delete on public.inventory_movements
  for each row execute function app.prevent_mutation(
    'actor_id', 'approved_by', 'location_id', 'to_location_id', 'audit_id', 'review_item_id');

-- ---------------------------------------------------------------------------
-- Notifications (defined here because stock changes raise them)
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null check (type in ('low_stock', 'out_of_stock', 'expiring', 'expired',
    'sync_failed', 'po_pending', 'ai_review', 'system')),
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  title text not null check (char_length(title) <= 200),
  body text check (char_length(body) <= 1000),
  link text check (link is null or link ~ '^/[A-Za-z0-9/_\-?=&.]*$'),
  dedupe_key text check (char_length(dedupe_key) <= 200),
  read_at timestamptz,
  email_sent_at timestamptz,
  push_sent_at timestamptz,
  whatsapp_sent_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index notifications_dedupe_uniq on public.notifications (business_id, user_id, dedupe_key)
  where dedupe_key is not null;
create index notifications_user_idx on public.notifications (user_id, created_at desc);

-- Fan a notification out to every active member at or above p_min_role.
create or replace function app.notify(
  p_business_id uuid, p_type text, p_severity text, p_title text, p_body text,
  p_link text, p_dedupe_key text, p_min_role public.member_role default 'manager'
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (business_id, user_id, type, severity, title, body, link, dedupe_key)
  select p_business_id, m.user_id, p_type, p_severity, left(p_title, 200), left(p_body, 1000), p_link, p_dedupe_key
  from public.business_members m
  where m.business_id = p_business_id and m.status = 'active'
    and case p_min_role
          when 'owner' then m.role = 'owner'
          when 'manager' then m.role in ('owner', 'manager')
          else true
        end
  on conflict (business_id, user_id, dedupe_key) where dedupe_key is not null do nothing;
$$;

-- ---------------------------------------------------------------------------
-- Stock engine
-- ---------------------------------------------------------------------------

-- Deduct p_amount from a product's batches FEFO (optionally a preferred batch
-- first). Returns allocations as jsonb [{batch_id, quantity}]. Any amount not
-- covered by batches is taken from unbatched stock by the caller.
create or replace function app.deduct_batches(p_product_id uuid, p_amount numeric, p_preferred_batch uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_remaining numeric := p_amount;
  v_take numeric;
  v_alloc jsonb := '[]'::jsonb;
  r record;
begin
  if p_preferred_batch is not null then
    select id, quantity into r from public.inventory_batches
    where id = p_preferred_batch and product_id = p_product_id for update;
    if r.id is null then
      raise exception 'batch_not_found' using errcode = 'P0002';
    end if;
    if r.quantity < p_amount then
      raise exception 'insufficient_batch_stock: batch has %, requested %', r.quantity, p_amount
        using errcode = 'P0001';
    end if;
    update public.inventory_batches set quantity = quantity - p_amount where id = r.id;
    return jsonb_build_array(jsonb_build_object('batch_id', r.id, 'quantity', p_amount));
  end if;

  for r in
    select id, quantity from public.inventory_batches
    where product_id = p_product_id and quantity > 0
    order by expiry_date asc nulls last, received_at asc, id
    for update
  loop
    exit when v_remaining <= 0;
    v_take := least(r.quantity, v_remaining);
    update public.inventory_batches set quantity = quantity - v_take where id = r.id;
    v_alloc := v_alloc || jsonb_build_object('batch_id', r.id, 'quantity', v_take);
    v_remaining := v_remaining - v_take;
  end loop;
  return v_alloc;
end;
$$;

-- Core stock engine. Callers must have authorized the actor already.
create or replace function app.apply_stock_movement_internal(
  p_business_id uuid,
  p_product_id uuid,
  p_type public.movement_type,
  p_quantity numeric,
  p_source public.movement_source,
  p_idempotency_key text,
  p_actor_id uuid,
  p_actor_role public.member_role,
  p_reason text default null,
  p_batch_id uuid default null,
  p_batch_number text default null,
  p_expiry_date date default null,
  p_unit_cost numeric default null,
  p_input_quantity numeric default null,
  p_input_unit text default null,
  p_ai_confidence numeric default null,
  p_review_item_id uuid default null,
  p_approved_by uuid default null,
  p_audit_id uuid default null,
  p_to_location_id uuid default null,
  p_observed_at timestamptz default null,
  p_external_ref text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.inventory_movements;
  v_product public.products;
  v_business public.businesses;
  v_before numeric;
  v_after numeric;
  v_change numeric;
  v_alloc jsonb := '[]'::jsonb;
  v_batch_id uuid := p_batch_id;
  v_batch public.inventory_batches;
  v_batch_total numeric;
  v_unit_cost numeric;
  v_observed timestamptz := coalesce(p_observed_at, now());
  v_movement public.inventory_movements;
  v_threshold_pct numeric;
begin
  if p_quantity is null then
    raise exception 'invalid_quantity: quantity is required' using errcode = '22023';
  end if;
  if p_type <> 'correction' and p_quantity < 0 then
    raise exception 'invalid_quantity: quantity must be non-negative' using errcode = '22023';
  end if;
  if p_type in ('receive', 'sale', 'return', 'damage', 'expire', 'missing', 'transfer', 'initial')
     and p_quantity = 0 then
    raise exception 'invalid_quantity: quantity must be greater than zero' using errcode = '22023';
  end if;
  if p_quantity > 10000000 then
    raise exception 'invalid_quantity: quantity is unrealistically large' using errcode = '22023';
  end if;

  -- Idempotency: replaying the same operation returns the original result.
  select * into v_existing from public.inventory_movements
  where business_id = p_business_id and idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    if v_existing.product_id <> p_product_id or v_existing.movement_type <> p_type then
      raise exception 'idempotency_conflict: key reused for a different operation' using errcode = 'P0001';
    end if;
    return to_jsonb(v_existing) || jsonb_build_object('duplicate', true);
  end if;

  select * into v_product from public.products
  where id = p_product_id and business_id = p_business_id
  for update;
  if v_product.id is null then
    raise exception 'product_not_found' using errcode = 'P0002';
  end if;
  if v_product.archived_at is not null and p_source <> 'pos' then
    raise exception 'product_archived' using errcode = 'P0001';
  end if;

  select * into v_business from public.businesses where id = p_business_id;
  v_before := v_product.current_quantity;

  -- Never let a stale observation (e.g. an old photo or a delayed POS count)
  -- overwrite a newer recorded stock level.
  if p_type = 'set_count' and v_product.last_movement_at is not null
     and v_observed < v_product.last_movement_at then
    raise exception 'stale_observation: stock changed at % after this count was observed at %',
      v_product.last_movement_at, v_observed using errcode = 'P0001';
  end if;

  v_change := case p_type
    when 'receive' then p_quantity
    when 'return' then p_quantity
    when 'initial' then p_quantity
    when 'sale' then -p_quantity
    when 'damage' then -p_quantity
    when 'expire' then -p_quantity
    when 'missing' then -p_quantity
    when 'set_count' then p_quantity - v_before
    when 'correction' then p_quantity
    when 'transfer' then 0
  end;

  if v_before + v_change < 0 then
    if p_source = 'pos' and p_type = 'sale' then
      -- POS already sold it; record what we can and flag the discrepancy.
      v_change := -v_before;
    else
      raise exception 'insufficient_stock: % on hand, cannot remove %', v_before, -v_change
        using errcode = 'P0001';
    end if;
  end if;

  -- Employees cannot make large adjustments without manager/owner approval.
  if p_actor_role = 'employee' and p_approved_by is null and p_type <> 'sale' and p_source <> 'purchase' then
    v_threshold_pct := case when v_before > 0 then abs(v_change) / v_before * 100 else 0 end;
    if abs(v_change) > v_business.large_adjustment_units
       or (v_before >= 10 and v_threshold_pct > v_business.large_adjustment_percent) then
      raise exception 'approval_required: change of % exceeds the employee limit', v_change
        using errcode = 'P0001';
    end if;
  end if;
  if p_type in ('correction', 'transfer', 'initial') and p_actor_role = 'employee' then
    raise exception 'forbidden: % requires manager role', p_type using errcode = '42501';
  end if;

  v_after := v_before + v_change;

  -- Batch bookkeeping
  if p_type in ('receive', 'return', 'initial')
     and (p_batch_id is not null or p_batch_number is not null or p_expiry_date is not null) then
    if p_batch_id is not null then
      select * into v_batch from public.inventory_batches
      where id = p_batch_id and product_id = p_product_id for update;
      if v_batch.id is null then
        raise exception 'batch_not_found' using errcode = 'P0002';
      end if;
      update public.inventory_batches set quantity = quantity + p_quantity where id = v_batch.id;
    else
      insert into public.inventory_batches
        (business_id, product_id, location_id, batch_number, expiry_date, quantity, unit_cost)
      values (p_business_id, p_product_id, v_product.location_id, nullif(trim(p_batch_number), ''),
              p_expiry_date, p_quantity, p_unit_cost)
      on conflict (product_id, coalesce(batch_number, ''), coalesce(expiry_date, 'infinity'::date))
      do update set quantity = public.inventory_batches.quantity + excluded.quantity,
                    unit_cost = coalesce(excluded.unit_cost, public.inventory_batches.unit_cost)
      returning * into v_batch;
    end if;
    v_batch_id := v_batch.id;
    v_alloc := jsonb_build_array(jsonb_build_object('batch_id', v_batch_id, 'quantity', p_quantity));
  elsif v_change < 0 then
    select coalesce(sum(quantity), 0) into v_batch_total
    from public.inventory_batches where product_id = p_product_id;
    -- Deduct from batches only as far as needed to keep sum(batches) <= stock,
    -- unless a specific batch was named or the movement is an expiry (which
    -- by definition affects dated batches).
    if p_batch_id is not null then
      v_alloc := app.deduct_batches(p_product_id, -v_change, p_batch_id);
    elsif p_type in ('sale', 'expire') then
      v_alloc := app.deduct_batches(p_product_id, least(-v_change, v_batch_total), null);
    elsif v_batch_total > v_after then
      v_alloc := app.deduct_batches(p_product_id, v_batch_total - v_after, null);
    end if;
    if jsonb_array_length(v_alloc) = 1 then
      v_batch_id := (v_alloc -> 0 ->> 'batch_id')::uuid;
    end if;
  elsif p_type = 'transfer' then
    if p_to_location_id is null or not exists
       (select 1 from public.business_locations where id = p_to_location_id and business_id = p_business_id) then
      raise exception 'invalid_location' using errcode = '22023';
    end if;
    if p_batch_id is not null then
      update public.inventory_batches set location_id = p_to_location_id
      where id = p_batch_id and product_id = p_product_id;
      if not found then
        raise exception 'batch_not_found' using errcode = 'P0002';
      end if;
    else
      update public.products set location_id = p_to_location_id where id = p_product_id;
    end if;
  end if;

  v_unit_cost := coalesce(p_unit_cost, v_batch.unit_cost, v_product.cost_price, 0);

  update public.products
  set current_quantity = v_after,
      last_movement_at = greatest(now(), v_observed),
      last_counted_at = case when p_type = 'set_count' then v_observed else last_counted_at end,
      cost_price = case
        -- Weighted-average cost on receipt when a cost is supplied.
        when p_type in ('receive', 'initial') and p_unit_cost is not null and v_after > 0
          then round((v_before * cost_price + p_quantity * p_unit_cost) / v_after, 2)
        else cost_price end
  where id = p_product_id;

  insert into public.inventory_movements (
    business_id, product_id, batch_id, location_id, to_location_id, audit_id, movement_type, source,
    quantity_before, quantity_after, quantity_change, input_quantity, input_unit, batch_allocations,
    unit_cost, value_change, reason, actor_id, ai_confidence, approval_status, approved_by,
    review_item_id, idempotency_key, external_ref, observed_at
  ) values (
    p_business_id, p_product_id, v_batch_id, v_product.location_id, p_to_location_id, p_audit_id, p_type,
    p_source, v_before, v_after, v_change, p_input_quantity, left(p_input_unit, 32), v_alloc,
    v_unit_cost, round(v_change * v_unit_cost, 2), left(p_reason, 500), p_actor_id, p_ai_confidence,
    case when p_approved_by is not null then 'approved' else 'not_required' end, p_approved_by,
    p_review_item_id, p_idempotency_key, left(p_external_ref, 200), v_observed
  )
  returning * into v_movement;

  -- Alerts when crossing thresholds
  if v_after <= 0 and v_before > 0 then
    perform app.notify(p_business_id, 'out_of_stock', 'critical',
      v_product.name || ' is out of stock', 'Stock reached zero.',
      '/inventory/' || p_product_id::text, 'out_of_stock:' || p_product_id::text || ':' || current_date::text,
      'manager');
  elsif v_after < v_product.reorder_threshold and v_before >= v_product.reorder_threshold then
    perform app.notify(p_business_id, 'low_stock', 'warning',
      v_product.name || ' is running low',
      'Only ' || trim(to_char(v_after, 'FM999999990.###')) || ' left (reorder at '
        || trim(to_char(v_product.reorder_threshold, 'FM999999990.###')) || ').',
      '/inventory/' || p_product_id::text, 'low_stock:' || p_product_id::text || ':' || current_date::text,
      'manager');
  end if;

  return to_jsonb(v_movement) || jsonb_build_object('duplicate', false);
exception
  when unique_violation then
    -- A concurrent request with the same idempotency key won the race.
    select * into v_existing from public.inventory_movements
    where business_id = p_business_id and idempotency_key = p_idempotency_key;
    if v_existing.id is null then
      raise;
    end if;
    return to_jsonb(v_existing) || jsonb_build_object('duplicate', true);
end;
$$;

-- Public RPC for signed-in users.
create or replace function public.apply_stock_movement(
  p_business_id uuid,
  p_product_id uuid,
  p_type public.movement_type,
  p_quantity numeric,
  p_idempotency_key text,
  p_source public.movement_source default 'manual',
  p_reason text default null,
  p_batch_id uuid default null,
  p_batch_number text default null,
  p_expiry_date date default null,
  p_unit_cost numeric default null,
  p_input_quantity numeric default null,
  p_input_unit text default null,
  p_ai_confidence numeric default null,
  p_audit_id uuid default null,
  p_to_location_id uuid default null,
  p_observed_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.member_role;
begin
  v_role := app.require_role(p_business_id, 'employee');
  if p_source in ('pos', 'system') then
    raise exception 'forbidden: source % is reserved for the server', p_source using errcode = '42501';
  end if;
  if p_audit_id is not null and not exists
     (select 1 from public.inventory_audits where id = p_audit_id and business_id = p_business_id) then
    raise exception 'cross_tenant_reference' using errcode = '42501';
  end if;
  return app.apply_stock_movement_internal(
    p_business_id, p_product_id, p_type, p_quantity, p_source, p_idempotency_key, auth.uid(), v_role,
    p_reason, p_batch_id, p_batch_number, p_expiry_date, p_unit_cost, p_input_quantity, p_input_unit,
    p_ai_confidence, null, null, p_audit_id, p_to_location_id, p_observed_at, null
  );
end;
$$;

-- Server-only variant used by POS webhooks and background jobs.
create or replace function public.apply_stock_movement_system(
  p_business_id uuid,
  p_product_id uuid,
  p_type public.movement_type,
  p_quantity numeric,
  p_idempotency_key text,
  p_source public.movement_source,
  p_reason text default null,
  p_observed_at timestamptz default null,
  p_external_ref text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_service_role() then
    raise exception 'forbidden: service role only' using errcode = '42501';
  end if;
  return app.apply_stock_movement_internal(
    p_business_id, p_product_id, p_type, p_quantity, p_source, p_idempotency_key, null, 'owner',
    p_reason, null, null, null, null, null, null, null, null, null, null, null, p_observed_at, p_external_ref
  );
end;
$$;

revoke all on function app.deduct_batches(uuid, numeric, uuid) from public;
revoke all on function app.apply_stock_movement_internal(uuid, uuid, public.movement_type, numeric,
  public.movement_source, text, uuid, public.member_role, text, uuid, text, date, numeric, numeric, text,
  numeric, uuid, uuid, uuid, uuid, timestamptz, text) from public;
revoke all on function public.apply_stock_movement(uuid, uuid, public.movement_type, numeric, text,
  public.movement_source, text, uuid, text, date, numeric, numeric, text, numeric, uuid, uuid, timestamptz)
  from public, anon;
grant execute on function public.apply_stock_movement(uuid, uuid, public.movement_type, numeric, text,
  public.movement_source, text, uuid, text, date, numeric, numeric, text, numeric, uuid, uuid, timestamptz)
  to authenticated;
revoke all on function public.apply_stock_movement_system(uuid, uuid, public.movement_type, numeric, text,
  public.movement_source, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.apply_stock_movement_system(uuid, uuid, public.movement_type, numeric, text,
  public.movement_source, text, timestamptz, text) to service_role;

-- Product search used by the matching engine (trigram + exact identifiers).
create or replace function public.search_products(p_business_id uuid, p_query text, p_limit integer default 25)
returns table (
  id uuid, name text, sku text, barcode text, brand text, category text, description text, color text,
  package_size text, synonyms text[], unit public.stock_unit, current_quantity numeric, score real
)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.id, p.name, p.sku, p.barcode, p.brand, c.name, p.description, p.color, p.package_size,
         p.synonyms, p.unit, p.current_quantity,
         greatest(
           extensions.similarity(lower(p.name), lower(p_query)),
           extensions.word_similarity(lower(p_query), lower(p.name || ' ' || coalesce(p.brand, '') || ' '
             || coalesce(p.description, '') || ' ' || array_to_string(p.synonyms, ' '))),
           case when lower(p.sku) = lower(p_query) or p.barcode = p_query then 1 else 0 end
         )::real as score
  from public.products p
  left join public.product_categories c on c.id = p.category_id
  where p.business_id = p_business_id and p.archived_at is null
  order by score desc, p.name
  limit least(greatest(p_limit, 1), 100);
$$;
revoke all on function public.search_products(uuid, text, integer) from public, anon;
grant execute on function public.search_products(uuid, text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS & privileges
-- ---------------------------------------------------------------------------
alter table public.product_categories enable row level security;
alter table public.suppliers enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.supplier_products enable row level security;
alter table public.supplier_price_history enable row level security;
alter table public.inventory_batches enable row level security;
alter table public.inventory_audits enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.notifications enable row level security;

revoke all on public.product_categories, public.suppliers, public.products, public.product_variants,
  public.supplier_products, public.supplier_price_history, public.inventory_batches, public.inventory_audits,
  public.inventory_movements, public.notifications from anon, authenticated;

-- Categories / suppliers / variants / supplier products: members read, managers write.
grant select, insert, update, delete on public.product_categories, public.suppliers,
  public.product_variants, public.supplier_products to authenticated;

create policy categories_select on public.product_categories for select to authenticated
  using (app.is_member(business_id));
create policy categories_write on public.product_categories for all to authenticated
  using (app.has_role(business_id, 'manager')) with check (app.has_role(business_id, 'manager'));

create policy suppliers_select on public.suppliers for select to authenticated
  using (app.is_member(business_id));
create policy suppliers_write on public.suppliers for all to authenticated
  using (app.has_role(business_id, 'manager')) with check (app.has_role(business_id, 'manager'));

create policy variants_select on public.product_variants for select to authenticated
  using (app.is_member(business_id));
create policy variants_write on public.product_variants for all to authenticated
  using (app.has_role(business_id, 'manager')) with check (app.has_role(business_id, 'manager'));

create policy supplier_products_select on public.supplier_products for select to authenticated
  using (app.is_member(business_id));
create policy supplier_products_write on public.supplier_products for all to authenticated
  using (app.has_role(business_id, 'manager')) with check (app.has_role(business_id, 'manager'));

grant select on public.supplier_price_history to authenticated;
create policy supplier_price_history_select on public.supplier_price_history for select to authenticated
  using (app.has_role(business_id, 'manager'));

-- Products: column-level grants keep stock columns out of reach.
grant select, delete on public.products to authenticated;
grant insert (business_id, location_id, category_id, preferred_supplier_id, name, sku, barcode, brand,
  description, color, package_size, synonyms, cost_price, selling_price, unit, reorder_threshold,
  reorder_quantity, storage_location, image_path, track_expiry)
  on public.products to authenticated;
grant update (location_id, category_id, preferred_supplier_id, name, sku, barcode, brand, description,
  color, package_size, synonyms, cost_price, selling_price, unit, reorder_threshold, reorder_quantity,
  storage_location, image_path, track_expiry, archived_at)
  on public.products to authenticated;
create policy products_select on public.products for select to authenticated
  using (app.is_member(business_id));
create policy products_insert on public.products for insert to authenticated
  with check (app.has_role(business_id, 'manager'));
create policy products_update on public.products for update to authenticated
  using (app.has_role(business_id, 'manager')) with check (app.has_role(business_id, 'manager'));
-- Hard delete is owner-only and impossible once any movement exists (FK restrict).
create policy products_delete on public.products for delete to authenticated
  using (app.has_role(business_id, 'owner'));

-- Batches: read for members, metadata edits for managers, quantity never.
grant select on public.inventory_batches to authenticated;
grant update (batch_number, expiry_date, location_id) on public.inventory_batches to authenticated;
create policy batches_select on public.inventory_batches for select to authenticated
  using (app.is_member(business_id));
create policy batches_update on public.inventory_batches for update to authenticated
  using (app.has_role(business_id, 'manager')) with check (app.has_role(business_id, 'manager'));

grant select, insert on public.inventory_audits to authenticated;
grant update (status, notes, completed_at) on public.inventory_audits to authenticated;
create policy audits_select on public.inventory_audits for select to authenticated
  using (app.is_member(business_id));
create policy audits_insert on public.inventory_audits for insert to authenticated
  with check (app.is_member(business_id) and started_by = auth.uid());
create policy audits_update on public.inventory_audits for update to authenticated
  using (started_by = auth.uid() or app.has_role(business_id, 'manager'))
  with check (started_by = auth.uid() or app.has_role(business_id, 'manager'));

-- Movements: read-only ledger.
grant select on public.inventory_movements to authenticated;
create policy movements_select on public.inventory_movements for select to authenticated
  using (app.is_member(business_id));

grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid() and app.is_member(business_id));
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
