-- StockPilot AI — Purchase orders.
--
-- Lifecycle: draft -> approved (owner only) -> sent -> partially_received -> received
--            any open state -> cancelled
-- Nothing is sent to a supplier without owner approval. Receiving goods always
-- goes through the stock engine (source = 'purchase').

create table public.business_counters (
  business_id uuid not null references public.businesses (id) on delete cascade,
  counter text not null check (counter in ('purchase_order')),
  value bigint not null default 0,
  primary key (business_id, counter)
);
alter table public.business_counters enable row level security;
revoke all on public.business_counters from anon, authenticated;

create or replace function app.next_counter(p_business_id uuid, p_counter text)
returns bigint
language sql
security definer
set search_path = ''
as $$
  insert into public.business_counters (business_id, counter, value)
  values (p_business_id, p_counter, 1)
  on conflict (business_id, counter) do update set value = public.business_counters.value + 1
  returning value;
$$;

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  supplier_id uuid not null references public.suppliers (id),
  po_number text not null,
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'sent', 'partially_received', 'received', 'cancelled')),
  notes text check (char_length(notes) <= 2000),
  expected_date date,
  subtotal numeric(14,2) not null default 0,
  generated_by_ai boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  sent_at timestamptz,
  sent_via text check (sent_via in ('email', 'whatsapp', 'manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, po_number)
);
create index purchase_orders_business_idx on public.purchase_orders (business_id, status, created_at desc);
create trigger purchase_orders_updated_at before update on public.purchase_orders
  for each row execute function app.set_updated_at();

create table public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  purchase_order_id uuid not null references public.purchase_orders (id) on delete cascade,
  product_id uuid not null references public.products (id),
  quantity numeric(14,3) not null check (quantity > 0 and quantity <= 1000000),
  unit_cost numeric(12,2) not null default 0 check (unit_cost >= 0),
  received_quantity numeric(14,3) not null default 0 check (received_quantity >= 0),
  line_total numeric(14,2) generated always as (round(quantity * unit_cost, 2)) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (purchase_order_id, product_id)
);
create index purchase_order_items_po_idx on public.purchase_order_items (purchase_order_id);
create trigger purchase_order_items_updated_at before update on public.purchase_order_items
  for each row execute function app.set_updated_at();

create or replace function app.recalculate_po_subtotal(p_po_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.purchase_orders
  set subtotal = coalesce((select sum(line_total) from public.purchase_order_items where purchase_order_id = p_po_id), 0)
  where id = p_po_id;
$$;

create or replace function app.po_items_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po public.purchase_orders;
begin
  select * into v_po from public.purchase_orders where id = coalesce(new.purchase_order_id, old.purchase_order_id);
  if tg_op <> 'DELETE' then
    if v_po.business_id <> new.business_id or not exists
       (select 1 from public.products where id = new.product_id and business_id = new.business_id) then
      raise exception 'cross_tenant_reference' using errcode = '42501';
    end if;
  end if;
  -- Line edits are only allowed while the order is a draft (receiving updates
  -- received_quantity through the security-definer RPC below).
  if v_po.status <> 'draft' and current_setting('app.po_receiving', true) is distinct from 'on' then
    raise exception 'purchase_order_locked: % orders cannot be edited', v_po.status using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger purchase_order_items_guard before insert or update or delete on public.purchase_order_items
  for each row execute function app.po_items_changed();

create or replace function app.po_items_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.recalculate_po_subtotal(coalesce(new.purchase_order_id, old.purchase_order_id));
  return null;
end;
$$;
create trigger purchase_order_items_subtotal after insert or update or delete on public.purchase_order_items
  for each row execute function app.po_items_after();

-- Create a draft PO with lines in one transaction.
-- p_items: [{"product_id": uuid, "quantity": number, "unit_cost": number}]
create or replace function public.create_purchase_order(
  p_business_id uuid, p_supplier_id uuid, p_items jsonb, p_notes text default null,
  p_expected_date date default null, p_generated_by_ai boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po uuid;
  v_item jsonb;
  v_supplier_name text;
begin
  perform app.require_role(p_business_id, 'manager');
  select name into v_supplier_name from public.suppliers
  where id = p_supplier_id and business_id = p_business_id and archived_at is null;
  if v_supplier_name is null then
    raise exception 'supplier_not_found' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 200 then
    raise exception 'invalid_items: between 1 and 200 lines required' using errcode = '22023';
  end if;

  insert into public.purchase_orders (business_id, supplier_id, po_number, notes, expected_date, generated_by_ai, created_by)
  values (p_business_id, p_supplier_id,
          'PO-' || lpad(app.next_counter(p_business_id, 'purchase_order')::text, 5, '0'),
          left(p_notes, 2000), p_expected_date, coalesce(p_generated_by_ai, false), auth.uid())
  returning id into v_po;

  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into public.purchase_order_items (business_id, purchase_order_id, product_id, quantity, unit_cost)
    values (p_business_id, v_po, (v_item ->> 'product_id')::uuid, (v_item ->> 'quantity')::numeric,
            coalesce((v_item ->> 'unit_cost')::numeric, 0))
    on conflict (purchase_order_id, product_id)
    do update set quantity = public.purchase_order_items.quantity + excluded.quantity;
  end loop;

  perform app.notify(p_business_id, 'po_pending', 'info', 'Purchase order awaiting approval',
    'A draft order for ' || v_supplier_name || ' is ready for your review.',
    '/purchase-orders/' || v_po::text, 'po_pending:' || v_po::text, 'owner');
  perform app.log_activity(p_business_id, 'purchase_order.created', 'purchase_order', v_po, '{}'::jsonb);
  return v_po;
end;
$$;

create or replace function public.transition_purchase_order(p_po_id uuid, p_action text, p_sent_via text default null)
returns public.purchase_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po public.purchase_orders;
begin
  select * into v_po from public.purchase_orders where id = p_po_id for update;
  if v_po.id is null then
    raise exception 'purchase_order_not_found' using errcode = 'P0002';
  end if;

  case p_action
    when 'approve' then
      perform app.require_role(v_po.business_id, 'owner');
      if v_po.status <> 'draft' then
        raise exception 'invalid_transition: cannot approve a % order', v_po.status using errcode = 'P0001';
      end if;
      if not exists (select 1 from public.purchase_order_items where purchase_order_id = p_po_id) then
        raise exception 'invalid_transition: order has no lines' using errcode = 'P0001';
      end if;
      update public.purchase_orders set status = 'approved', approved_by = auth.uid(), approved_at = now()
      where id = p_po_id returning * into v_po;
    when 'mark_sent' then
      perform app.require_role(v_po.business_id, 'manager');
      if v_po.status <> 'approved' then
        raise exception 'invalid_transition: only approved orders can be sent' using errcode = 'P0001';
      end if;
      if p_sent_via not in ('email', 'whatsapp', 'manual') then
        raise exception 'invalid_channel' using errcode = '22023';
      end if;
      update public.purchase_orders set status = 'sent', sent_at = now(), sent_via = p_sent_via
      where id = p_po_id returning * into v_po;
    when 'cancel' then
      perform app.require_role(v_po.business_id, case when v_po.status = 'draft' then 'manager' else 'owner' end::public.member_role);
      if v_po.status in ('received', 'cancelled') then
        raise exception 'invalid_transition: order is already %', v_po.status using errcode = 'P0001';
      end if;
      update public.purchase_orders set status = 'cancelled' where id = p_po_id returning * into v_po;
    else
      raise exception 'invalid_action' using errcode = '22023';
  end case;

  perform app.log_activity(v_po.business_id, 'purchase_order.' || p_action, 'purchase_order', p_po_id,
    jsonb_build_object('status', v_po.status));
  return v_po;
end;
$$;

create or replace function public.receive_purchase_order_item(
  p_item_id uuid, p_quantity numeric, p_idempotency_key text,
  p_batch_number text default null, p_expiry_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.purchase_order_items;
  v_po public.purchase_orders;
  v_role public.member_role;
  v_result jsonb;
begin
  select * into v_item from public.purchase_order_items where id = p_item_id for update;
  if v_item.id is null then
    raise exception 'purchase_order_item_not_found' using errcode = 'P0002';
  end if;
  select * into v_po from public.purchase_orders where id = v_item.purchase_order_id for update;
  v_role := app.require_role(v_po.business_id, 'manager');
  if v_po.status not in ('approved', 'sent', 'partially_received') then
    raise exception 'invalid_transition: cannot receive against a % order', v_po.status using errcode = 'P0001';
  end if;
  if p_quantity <= 0 or v_item.received_quantity + p_quantity > v_item.quantity * 2 then
    raise exception 'invalid_quantity: receipt exceeds twice the ordered amount' using errcode = '22023';
  end if;

  v_result := app.apply_stock_movement_internal(
    v_po.business_id, v_item.product_id, 'receive', p_quantity, 'purchase',
    'po:' || p_item_id::text || ':' || p_idempotency_key, auth.uid(), v_role,
    'Received on ' || v_po.po_number, null, p_batch_number, p_expiry_date, v_item.unit_cost,
    p_quantity, null, null, null, auth.uid(), null, null, null, v_po.po_number
  );

  if not (v_result ->> 'duplicate')::boolean then
    perform set_config('app.po_receiving', 'on', true);
    update public.purchase_order_items set received_quantity = received_quantity + p_quantity where id = p_item_id;
    perform set_config('app.po_receiving', 'off', true);

    update public.purchase_orders
    set status = case
      when not exists (select 1 from public.purchase_order_items
                       where purchase_order_id = v_po.id and received_quantity < quantity) then 'received'
      else 'partially_received' end
    where id = v_po.id;
  end if;
  return v_result;
end;
$$;

revoke all on function public.create_purchase_order(uuid, uuid, jsonb, text, date, boolean) from public, anon;
grant execute on function public.create_purchase_order(uuid, uuid, jsonb, text, date, boolean) to authenticated;
revoke all on function public.transition_purchase_order(uuid, text, text) from public, anon;
grant execute on function public.transition_purchase_order(uuid, text, text) to authenticated;
revoke all on function public.receive_purchase_order_item(uuid, numeric, text, text, date) from public, anon;
grant execute on function public.receive_purchase_order_item(uuid, numeric, text, text, date) to authenticated;

alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;
revoke all on public.purchase_orders, public.purchase_order_items from anon, authenticated;

grant select on public.purchase_orders to authenticated;
grant update (notes, expected_date) on public.purchase_orders to authenticated;
create policy po_select on public.purchase_orders for select to authenticated
  using (app.has_role(business_id, 'manager'));
create policy po_update on public.purchase_orders for update to authenticated
  using (app.has_role(business_id, 'manager') and status = 'draft')
  with check (app.has_role(business_id, 'manager') and status = 'draft');

grant select, insert, delete on public.purchase_order_items to authenticated;
grant update (quantity, unit_cost) on public.purchase_order_items to authenticated;
create policy po_items_select on public.purchase_order_items for select to authenticated
  using (app.has_role(business_id, 'manager'));
create policy po_items_write on public.purchase_order_items for all to authenticated
  using (app.has_role(business_id, 'manager')) with check (app.has_role(business_id, 'manager'));
