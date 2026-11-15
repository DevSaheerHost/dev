-- StockPilot AI — POS integrations, webhooks, notification channels,
-- rate limiting, storage policies and tenant purge.

-- ---------------------------------------------------------------------------
-- Integrations
-- ---------------------------------------------------------------------------
create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  provider text not null check (provider in ('square', 'shopify', 'clover')),
  status text not null default 'not_connected'
    check (status in ('not_connected', 'connected', 'error', 'disconnected')),
  external_account_id text check (char_length(external_account_id) <= 200),
  shop_domain text check (shop_domain is null or shop_domain ~ '^[a-z0-9][a-z0-9\-]*\.myshopify\.com$'),
  external_location_id text check (char_length(external_location_id) <= 200),
  -- Which side wins on conflict: 'pos' trusts POS counts, 'stockpilot' trusts
  -- local physical counts; newer timestamp always wins within the same side.
  conflict_policy text not null default 'newest_wins'
    check (conflict_policy in ('newest_wins', 'pos', 'stockpilot')),
  sync_enabled boolean not null default true,
  last_synced_at timestamptz,
  last_error text check (char_length(last_error) <= 1000),
  connected_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, provider)
);
create index integrations_account_idx on public.integrations (provider, external_account_id);
create trigger integrations_updated_at before update on public.integrations
  for each row execute function app.set_updated_at();

-- Encrypted (AES-256-GCM, application key) OAuth tokens. RLS on and no
-- policies: only the service role can read or write this table.
create table public.integration_credentials (
  integration_id uuid primary key references public.integrations (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  access_token_encrypted text not null,
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  scopes text,
  updated_at timestamptz not null default now()
);

-- One-time OAuth state values (CSRF protection), hashed.
create table public.integration_oauth_states (
  state_hash text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  provider text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  shop_domain text,
  expires_at timestamptz not null default now() + interval '10 minutes',
  created_at timestamptz not null default now()
);

create table public.integration_product_mappings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  integration_id uuid not null references public.integrations (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  external_item_id text not null check (char_length(external_item_id) <= 200),
  external_variant_id text not null check (char_length(external_variant_id) <= 200),
  external_sku text check (char_length(external_sku) <= 200),
  external_name text check (char_length(external_name) <= 300),
  last_external_quantity numeric(14,3),
  last_external_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (integration_id, external_variant_id)
);
create index integration_mappings_product_idx on public.integration_product_mappings (product_id);
create trigger integration_mappings_updated_at before update on public.integration_product_mappings
  for each row execute function app.set_updated_at();

create table public.integration_sync_logs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  integration_id uuid not null references public.integrations (id) on delete cascade,
  direction text not null check (direction in ('pull', 'push', 'webhook')),
  status text not null check (status in ('running', 'success', 'partial', 'failed', 'conflict', 'skipped')),
  items_processed integer not null default 0,
  conflicts integer not null default 0,
  error text check (char_length(error) <= 2000),
  attempt integer not null default 1 check (attempt between 1 and 10),
  next_retry_at timestamptz,
  details jsonb not null default '{}'::jsonb,
  triggered_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index integration_sync_logs_idx on public.integration_sync_logs (integration_id, created_at desc);
create index integration_sync_logs_retry_idx on public.integration_sync_logs (next_retry_at)
  where status = 'failed' and next_retry_at is not null;

-- Webhook de-duplication: (provider, event_id) can only ever be processed once.
create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('square', 'shopify', 'clover')),
  event_id text not null check (char_length(event_id) <= 200),
  event_type text check (char_length(event_type) <= 120),
  business_id uuid references public.businesses (id) on delete cascade,
  integration_id uuid references public.integrations (id) on delete cascade,
  status text not null default 'received' check (status in ('received', 'processed', 'ignored', 'failed')),
  error text check (char_length(error) <= 2000),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, event_id)
);

-- ---------------------------------------------------------------------------
-- Notification channels
-- ---------------------------------------------------------------------------
create table public.notification_preferences (
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  email_enabled boolean not null default true,
  push_enabled boolean not null default false,
  whatsapp_enabled boolean not null default false,
  whatsapp_number text check (whatsapp_number is null or whatsapp_number ~ '^\+?[0-9]{7,15}$'),
  types jsonb not null default
    '{"low_stock":true,"out_of_stock":true,"expiring":true,"expired":true,"sync_failed":true,"po_pending":true,"ai_review":true}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (business_id, user_id)
);
create trigger notification_preferences_updated_at before update on public.notification_preferences
  for each row execute function app.set_updated_at();

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh text not null check (char_length(p256dh) <= 200),
  auth text not null check (char_length(auth) <= 100),
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- ---------------------------------------------------------------------------
-- Rate limiting (fixed window, server-side only)
-- ---------------------------------------------------------------------------
create table public.rate_limits (
  key text primary key check (char_length(key) <= 200),
  window_start timestamptz not null,
  count integer not null
);

create or replace function public.check_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.rate_limits as r (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update
    set count = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.count + 1 end,
        window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
  returning count into v_count;
  return v_count <= p_limit;
end;
$$;
revoke all on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Tenant purge (service role only; the only way ledgers are ever deleted)
-- ---------------------------------------------------------------------------
create or replace function public.purge_business(p_business_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_service_role() then
    raise exception 'forbidden: service role only' using errcode = '42501';
  end if;
  perform set_config('app.purge', 'on', true);
  -- Ledgers reference products/batches with RESTRICT; remove them first.
  delete from public.inventory_movements where business_id = p_business_id;
  delete from public.purchase_order_items where business_id = p_business_id;
  delete from public.businesses where id = p_business_id;
  perform set_config('app.purge', 'off', true);
end;
$$;
revoke all on function public.purge_business(uuid) from public, anon, authenticated;
grant execute on function public.purge_business(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.integrations enable row level security;
alter table public.integration_credentials enable row level security;
alter table public.integration_oauth_states enable row level security;
alter table public.integration_product_mappings enable row level security;
alter table public.integration_sync_logs enable row level security;
alter table public.webhook_events enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.rate_limits enable row level security;

revoke all on public.integrations, public.integration_credentials, public.integration_oauth_states,
  public.integration_product_mappings, public.integration_sync_logs, public.webhook_events,
  public.notification_preferences, public.push_subscriptions, public.rate_limits from anon, authenticated;

grant select on public.integrations to authenticated;
grant update (conflict_policy, sync_enabled) on public.integrations to authenticated;
create policy integrations_select on public.integrations for select to authenticated
  using (app.has_role(business_id, 'manager'));
create policy integrations_update on public.integrations for update to authenticated
  using (app.has_role(business_id, 'owner')) with check (app.has_role(business_id, 'owner'));

grant select on public.integration_product_mappings to authenticated;
grant update (product_id) on public.integration_product_mappings to authenticated;
create policy mappings_select on public.integration_product_mappings for select to authenticated
  using (app.has_role(business_id, 'manager'));
create policy mappings_update on public.integration_product_mappings for update to authenticated
  using (app.has_role(business_id, 'manager'))
  with check (app.has_role(business_id, 'manager')
    and (product_id is null or exists (select 1 from public.products p
         where p.id = product_id and p.business_id = integration_product_mappings.business_id)));

grant select on public.integration_sync_logs to authenticated;
create policy sync_logs_select on public.integration_sync_logs for select to authenticated
  using (app.has_role(business_id, 'manager'));

grant select, insert, update on public.notification_preferences to authenticated;
create policy notification_prefs_all on public.notification_preferences for all to authenticated
  using (user_id = auth.uid() and app.is_member(business_id))
  with check (user_id = auth.uid() and app.is_member(business_id));

grant select, insert, delete on public.push_subscriptions to authenticated;
create policy push_subscriptions_all on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Storage: private bucket, objects namespaced by business id.
-- Guarded so the migration also runs on plain Postgres (tests).
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('inventory-media', 'inventory-media', false, 10485760,
            array['image/jpeg', 'image/png', 'image/webp', 'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav'])
    on conflict (id) do nothing;

    execute $p$
      create policy inventory_media_select on storage.objects for select to authenticated
      using (bucket_id = 'inventory-media'
             and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
             and app.is_member(((storage.foldername(name))[1])::uuid))
    $p$;
    execute $p$
      create policy inventory_media_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'inventory-media'
                  and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
                  and app.is_member(((storage.foldername(name))[1])::uuid))
    $p$;
    execute $p$
      create policy inventory_media_delete on storage.objects for delete to authenticated
      using (bucket_id = 'inventory-media'
             and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
             and app.has_role(((storage.foldername(name))[1])::uuid, 'manager'))
    $p$;
  end if;
end;
$$;

-- Realtime: stream stock and notification changes to signed-in clients
-- (RLS still applies to every realtime payload).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.products, public.notifications, public.ai_review_queue;
  end if;
end;
$$;
