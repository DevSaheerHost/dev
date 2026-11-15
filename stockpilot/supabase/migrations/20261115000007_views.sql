-- StockPilot AI — Read views. security_invoker makes every view evaluate RLS
-- as the calling user, so views never widen access.

create view public.product_overview
with (security_invoker = true) as
select
  p.id, p.business_id, p.name, p.sku, p.barcode, p.brand, p.unit, p.current_quantity, p.reorder_threshold,
  p.reorder_quantity, p.cost_price, p.selling_price, p.storage_location, p.track_expiry, p.archived_at,
  p.preferred_supplier_id, p.updated_at, p.last_counted_at, p.last_movement_at,
  c.name as category,
  s.name as supplier_name,
  case
    when p.current_quantity <= 0 then 'out_of_stock'
    when p.reorder_threshold > 0 and p.current_quantity < p.reorder_threshold then 'low_stock'
    else 'ok'
  end as stock_status,
  (select min(b.expiry_date) from public.inventory_batches b where b.product_id = p.id and b.quantity > 0) as next_expiry
from public.products p
left join public.product_categories c on c.id = p.category_id
left join public.suppliers s on s.id = p.preferred_supplier_id;

revoke all on public.product_overview from anon;
grant select on public.product_overview to authenticated;

create view public.expiring_batches
with (security_invoker = true) as
select
  b.id, b.business_id, b.product_id, b.batch_number, b.expiry_date, b.quantity, b.received_at,
  coalesce(b.unit_cost, p.cost_price) as unit_cost,
  round(b.quantity * coalesce(b.unit_cost, p.cost_price), 2) as value_at_risk,
  p.name as product_name, p.unit, p.sku, p.storage_location
from public.inventory_batches b
join public.products p on p.id = b.product_id and p.archived_at is null
where b.quantity > 0 and b.expiry_date is not null;

revoke all on public.expiring_batches from anon;
grant select on public.expiring_batches to authenticated;
