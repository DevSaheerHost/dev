-- StockPilot AI — Dashboard and reports. All figures are computed from real
-- records; nothing here is sampled or simulated.

create or replace function public.dashboard_summary(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.member_role;
  v_warning integer;
  v_result jsonb;
  v_since timestamptz := date_trunc('day', now()) - interval '29 days';
begin
  v_role := app.require_role(p_business_id, 'employee');
  select expiry_warning_days into v_warning from public.businesses where id = p_business_id;

  with p as (
    select * from public.products where business_id = p_business_id and archived_at is null
  ),
  b as (
    select ib.*, pr.name as product_name, pr.unit, coalesce(ib.unit_cost, pr.cost_price) as cost
    from public.inventory_batches ib
    join public.products pr on pr.id = ib.product_id and pr.archived_at is null
    where ib.business_id = p_business_id and ib.quantity > 0 and ib.expiry_date is not null
  ),
  m as (
    select * from public.inventory_movements
    where business_id = p_business_id and created_at >= v_since
  ),
  days as (
    select generate_series(v_since::date, current_date, interval '1 day')::date as day
  ),
  daily as (
    select d.day,
           coalesce(sum(m.quantity_change) filter (where m.quantity_change > 0), 0) as inbound,
           coalesce(-sum(m.quantity_change) filter (where m.quantity_change < 0), 0) as outbound,
           coalesce(sum(m.quantity_change), 0) as net
    from days d
    left join m on m.created_at::date = d.day
    group by d.day
  ),
  trend as (
    select day, inbound, outbound,
           (select coalesce(sum(current_quantity), 0) from p)
             - coalesce(sum(net) over (order by day desc rows between unbounded preceding and 1 preceding), 0)
             as units_end_of_day
    from daily
  )
  select jsonb_build_object(
    'role', v_role,
    'total_products', (select count(*) from p),
    'total_units', (select coalesce(sum(current_quantity), 0) from p),
    'inventory_value', case when v_role in ('owner', 'manager')
                         then (select coalesce(round(sum(current_quantity * cost_price), 2), 0) from p) end,
    'low_stock', (select count(*) from p where current_quantity > 0 and current_quantity < reorder_threshold),
    'out_of_stock', (select count(*) from p where current_quantity = 0),
    'expiring_soon', (select count(*) from b where expiry_date between current_date and current_date + v_warning),
    'expired', (select count(*) from b where expiry_date < current_date),
    'damaged_units_30d', (select coalesce(-sum(quantity_change), 0) from m where movement_type = 'damage'),
    'damaged_value_30d', case when v_role in ('owner', 'manager')
                           then (select coalesce(-sum(value_change), 0) from m where movement_type = 'damage') end,
    'pending_purchase_orders', (select count(*) from public.purchase_orders
                                where business_id = p_business_id and status in ('draft', 'approved')),
    'pending_reviews', (select count(*) from public.ai_review_queue
                        where business_id = p_business_id and status in ('pending', 'needs_clarification')
                          and (v_role <> 'employee' or created_by = auth.uid())),
    'trend', (select coalesce(jsonb_agg(jsonb_build_object('day', day, 'inbound', inbound, 'outbound', outbound,
                                         'units', units_end_of_day) order by day), '[]'::jsonb) from trend),
    'movement_by_type', (select coalesce(jsonb_agg(jsonb_build_object('type', movement_type, 'count', c, 'units', u)
                                                   order by c desc), '[]'::jsonb)
                         from (select movement_type, count(*) c, sum(abs(quantity_change)) u from m group by movement_type) t),
    'expiry_buckets', jsonb_build_object(
        'expired', (select count(*) from b where expiry_date < current_date),
        'within_7', (select count(*) from b where expiry_date between current_date and current_date + 7),
        'within_15', (select count(*) from b where expiry_date between current_date + 8 and current_date + 15),
        'within_30', (select count(*) from b where expiry_date between current_date + 16 and current_date + 30)),
    'top_selling', (select coalesce(jsonb_agg(t order by t.units desc), '[]'::jsonb) from (
                      select pr.id, pr.name, pr.unit, -sum(m.quantity_change) as units
                      from m join public.products pr on pr.id = m.product_id
                      where m.movement_type = 'sale'
                      group by pr.id, pr.name, pr.unit order by units desc limit 5) t),
    'recent_movements', (select coalesce(jsonb_agg(t order by t.created_at desc), '[]'::jsonb) from (
                           select mv.id, mv.created_at, mv.movement_type, mv.source, mv.quantity_change,
                                  mv.quantity_after, pr.name as product_name, pr.unit, pf.full_name as actor_name,
                                  mv.ai_confidence
                           from public.inventory_movements mv
                           join public.products pr on pr.id = mv.product_id
                           left join public.profiles pf on pf.id = mv.actor_id
                           where mv.business_id = p_business_id
                           order by mv.created_at desc limit 8) t),
    'recent_ai', (select coalesce(jsonb_agg(t order by t.created_at desc), '[]'::jsonb) from (
                    select e.id, e.created_at, e.source_type, e.is_valid, e.overall_confidence,
                           (select count(*) from public.ai_review_queue q where q.extraction_id = e.id) as actions,
                           (select count(*) from public.ai_review_queue q where q.extraction_id = e.id and q.status = 'applied') as applied
                    from public.ai_extractions e
                    where e.business_id = p_business_id and (v_role <> 'employee' or e.created_by = auth.uid())
                    order by e.created_at desc limit 5) t)
  ) into v_result;

  return v_result;
end;
$$;
revoke all on function public.dashboard_summary(uuid) from public, anon;
grant execute on function public.dashboard_summary(uuid) to authenticated;

-- Tabular reports for managers/owners. Returns a jsonb array of flat rows so
-- the same output feeds both the UI table and CSV export.
create or replace function public.inventory_report(
  p_business_id uuid, p_report text, p_from date, p_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from timestamptz;
  v_to timestamptz;
  v_rows jsonb;
begin
  perform app.require_role(p_business_id, 'manager');
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 731 then
    raise exception 'invalid_range: choose a range of at most two years' using errcode = '22023';
  end if;
  v_from := p_from::timestamptz;
  v_to := (p_to + 1)::timestamptz;

  case p_report
    when 'daily_changes' then
      select coalesce(jsonb_agg(t order by t.day desc, t.product), '[]'::jsonb) into v_rows from (
        select m.created_at::date as day, pr.name as product, pr.unit,
               sum(m.quantity_change) filter (where m.quantity_change > 0) as added,
               -sum(m.quantity_change) filter (where m.quantity_change < 0) as removed,
               sum(m.quantity_change) as net, count(*) as movements
        from public.inventory_movements m join public.products pr on pr.id = m.product_id
        where m.business_id = p_business_id and m.created_at >= v_from and m.created_at < v_to
        group by 1, 2, 3) t;

    when 'weekly_summary' then
      select coalesce(jsonb_agg(t order by t.week desc), '[]'::jsonb) into v_rows from (
        select date_trunc('week', m.created_at)::date as week,
               count(*) as movements,
               count(distinct m.product_id) as products_touched,
               coalesce(sum(m.quantity_change) filter (where m.movement_type in ('receive', 'return', 'initial')), 0) as received,
               coalesce(-sum(m.quantity_change) filter (where m.movement_type = 'sale'), 0) as sold,
               coalesce(-sum(m.quantity_change) filter (where m.movement_type in ('damage', 'expire', 'missing')), 0) as lost,
               coalesce(-sum(m.value_change) filter (where m.movement_type in ('damage', 'expire', 'missing')), 0) as loss_value
        from public.inventory_movements m
        where m.business_id = p_business_id and m.created_at >= v_from and m.created_at < v_to
        group by 1) t;

    when 'monthly_valuation' then
      -- Units at each month end are reconstructed from the movement ledger and
      -- valued at the product's current average cost.
      select coalesce(jsonb_agg(t order by t.month desc), '[]'::jsonb) into v_rows from (
        select mo.month::date as month,
               round(sum(greatest(pr.current_quantity - coalesce((
                 select sum(m.quantity_change) from public.inventory_movements m
                 where m.product_id = pr.id and m.created_at >= mo.month + interval '1 month'), 0), 0)), 3) as units,
               round(sum(greatest(pr.current_quantity - coalesce((
                 select sum(m.quantity_change) from public.inventory_movements m
                 where m.product_id = pr.id and m.created_at >= mo.month + interval '1 month'), 0), 0) * pr.cost_price), 2) as value
        from generate_series(date_trunc('month', v_from), date_trunc('month', v_to - interval '1 day'), interval '1 month') mo(month)
        cross join public.products pr
        where pr.business_id = p_business_id and pr.created_at < mo.month + interval '1 month'
        group by mo.month) t;

    when 'expired_loss', 'damaged_loss' then
      select coalesce(jsonb_agg(t order by t.loss_value desc), '[]'::jsonb) into v_rows from (
        select pr.name as product, pr.sku, pr.unit,
               -sum(m.quantity_change) as units, -sum(m.value_change) as loss_value, count(*) as incidents,
               max(m.created_at) as last_incident
        from public.inventory_movements m join public.products pr on pr.id = m.product_id
        where m.business_id = p_business_id and m.created_at >= v_from and m.created_at < v_to
          and m.movement_type = case p_report when 'expired_loss' then 'expire' else 'damage' end::public.movement_type
        group by pr.name, pr.sku, pr.unit) t;

    when 'shrinkage' then
      select coalesce(jsonb_agg(t order by t.loss_value desc), '[]'::jsonb) into v_rows from (
        select pr.name as product, pr.sku, pr.unit,
               coalesce(-sum(m.quantity_change) filter (where m.movement_type = 'missing'), 0) as missing,
               coalesce(-sum(m.quantity_change) filter (where m.movement_type = 'damage'), 0) as damaged,
               coalesce(-sum(m.quantity_change) filter (where m.movement_type = 'expire'), 0) as expired,
               coalesce(-sum(m.quantity_change) filter (where m.movement_type = 'set_count' and m.quantity_change < 0), 0)
                 as count_shortfall,
               coalesce(-sum(m.value_change) filter (where m.movement_type in ('missing', 'damage', 'expire')
                 or (m.movement_type = 'set_count' and m.quantity_change < 0)), 0) as loss_value
        from public.inventory_movements m join public.products pr on pr.id = m.product_id
        where m.business_id = p_business_id and m.created_at >= v_from and m.created_at < v_to
          and (m.movement_type in ('missing', 'damage', 'expire') or (m.movement_type = 'set_count' and m.quantity_change < 0))
        group by pr.name, pr.sku, pr.unit) t;

    when 'stockout_frequency' then
      select coalesce(jsonb_agg(t order by t.stockouts desc), '[]'::jsonb) into v_rows from (
        select pr.name as product, pr.sku, count(*) as stockouts, max(m.created_at) as last_stockout,
               pr.current_quantity as current_quantity
        from public.inventory_movements m join public.products pr on pr.id = m.product_id
        where m.business_id = p_business_id and m.created_at >= v_from and m.created_at < v_to
          and m.quantity_after = 0 and m.quantity_before > 0
        group by pr.name, pr.sku, pr.current_quantity) t;

    when 'reorder_history' then
      select coalesce(jsonb_agg(t order by t.created_at desc), '[]'::jsonb) into v_rows from (
        select po.po_number, s.name as supplier, po.status, po.subtotal, po.generated_by_ai,
               po.created_at, po.approved_at, po.sent_at,
               (select count(*) from public.purchase_order_items i where i.purchase_order_id = po.id) as lines
        from public.purchase_orders po join public.suppliers s on s.id = po.supplier_id
        where po.business_id = p_business_id and po.created_at >= v_from and po.created_at < v_to) t;

    when 'employee_activity' then
      select coalesce(jsonb_agg(t order by t.movements desc), '[]'::jsonb) into v_rows from (
        select coalesce(pf.full_name, pf.email, 'System / POS') as employee,
               count(*) as movements,
               count(*) filter (where m.source = 'voice') as voice,
               count(*) filter (where m.source = 'photo') as photo,
               count(*) filter (where m.source = 'manual') as manual,
               count(*) filter (where m.movement_type = 'set_count') as counts,
               max(m.created_at) as last_activity
        from public.inventory_movements m left join public.profiles pf on pf.id = m.actor_id
        where m.business_id = p_business_id and m.created_at >= v_from and m.created_at < v_to
        group by pf.full_name, pf.email) t;

    when 'ai_accuracy' then
      select coalesce(jsonb_agg(t order by t.source), '[]'::jsonb) into v_rows from (
        select q.source_type as source,
               count(*) as proposals,
               count(*) filter (where q.status = 'applied' and not q.was_edited) as accepted_as_is,
               count(*) filter (where q.status = 'applied' and q.was_edited) as accepted_after_edit,
               count(*) filter (where q.status = 'rejected') as rejected,
               count(*) filter (where q.status in ('pending', 'needs_clarification')) as open,
               round(100.0 * count(*) filter (where q.status = 'applied' and not q.was_edited)
                     / nullif(count(*) filter (where q.status in ('applied', 'rejected')), 0), 1) as accuracy_percent,
               round(avg(q.ai_confidence), 3) as avg_confidence
        from public.ai_review_queue q
        where q.business_id = p_business_id and q.created_at >= v_from and q.created_at < v_to
        group by q.source_type) t;

    else
      raise exception 'unknown_report' using errcode = '22023';
  end case;
  return v_rows;
end;
$$;
revoke all on function public.inventory_report(uuid, text, date, date) from public, anon;
grant execute on function public.inventory_report(uuid, text, date, date) to authenticated;

-- Daily alert sweep for expiring/expired batches (called by the cron route
-- with the service role). Notifications are de-duplicated per batch per day.
create or replace function public.run_expiry_alerts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_count integer := 0;
begin
  if not app.is_service_role() then
    raise exception 'forbidden: service role only' using errcode = '42501';
  end if;
  for r in
    select ib.id, ib.business_id, ib.product_id, ib.expiry_date, ib.quantity, pr.name, b.expiry_warning_days
    from public.inventory_batches ib
    join public.products pr on pr.id = ib.product_id and pr.archived_at is null
    join public.businesses b on b.id = ib.business_id
    where ib.quantity > 0 and ib.expiry_date is not null
      and ib.expiry_date <= current_date + least(b.expiry_warning_days, 30)
  loop
    if r.expiry_date < current_date then
      perform app.notify(r.business_id, 'expired', 'critical', r.name || ' has expired stock',
        trim(to_char(r.quantity, 'FM999999990.###')) || ' units expired on ' || r.expiry_date::text
          || '. Remove them from the shelf and record the loss.',
        '/expiring', 'expired:' || r.id::text, 'manager');
    else
      perform app.notify(r.business_id, 'expiring', 'warning', r.name || ' expires soon',
        trim(to_char(r.quantity, 'FM999999990.###')) || ' units expire on ' || r.expiry_date::text || '.',
        '/expiring', 'expiring:' || r.id::text || ':' || (r.expiry_date - current_date <= 7)::text, 'manager');
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.run_expiry_alerts() from public, anon, authenticated;
grant execute on function public.run_expiry_alerts() to service_role;
