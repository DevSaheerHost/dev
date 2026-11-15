-- StockPilot AI — Foundation: tenancy, identity, membership, RBAC helpers.
--
-- Security model
--   * Every tenant-owned row carries business_id and is protected by RLS.
--   * Internal helpers live in schema `app`, which PostgREST does not expose.
--   * Privileged operations are SECURITY DEFINER functions with a pinned
--     search_path that re-check membership and role before doing anything.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- Supabase grants broad default privileges to anon/authenticated. We lock the
-- anon role out of everything in public and grant authenticated per table.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from anon, public;
alter default privileges in schema public revoke all on sequences from anon;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.member_role as enum ('owner', 'manager', 'employee');
create type public.member_status as enum ('active', 'disabled');

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------
create or replace function app.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Immutability guard for ledgers. Rows may never be edited or deleted, with two
-- narrow exceptions:
--   * TG_ARGV lists reference columns that foreign keys may null out
--     (ON DELETE SET NULL); an UPDATE that only nulls those columns is allowed.
--   * A tenant purge run by public.purge_business (service role only).
create or replace function app.prevent_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_col text;
  v_old jsonb;
  v_new jsonb;
begin
  if current_setting('app.purge', true) = 'on' then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and tg_nargs > 0 then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    foreach v_col in array tg_argv loop
      if v_new -> v_col <> 'null'::jsonb and v_new -> v_col is distinct from v_old -> v_col then
        raise exception 'immutable_record: % rows cannot be modified', tg_table_name using errcode = 'P0001';
      end if;
      v_old := v_old - v_col;
      v_new := v_new - v_col;
    end loop;
    if v_old = v_new then
      return new;
    end if;
  end if;
  raise exception 'immutable_record: % rows cannot be modified or deleted', tg_table_name
    using errcode = 'P0001';
end;
$$;

-- Role of the caller as stated in the verified JWT (Supabase sets this GUC).
create or replace function app.jwt_role()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
$$;

create or replace function app.is_service_role()
returns boolean
language sql
stable
set search_path = ''
as $$
  select app.jwt_role() = 'service_role';
$$;

-- ---------------------------------------------------------------------------
-- Businesses (tenants)
-- ---------------------------------------------------------------------------
create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  business_type text not null default 'retail'
    check (business_type in ('retail', 'hardware', 'grocery', 'pharmacy', 'convenience', 'other')),
  currency char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  timezone text not null default 'UTC' check (char_length(timezone) <= 64),
  -- Inventory rules (owner configurable)
  large_adjustment_units numeric(14,3) not null default 50 check (large_adjustment_units > 0),
  large_adjustment_percent numeric(6,2) not null default 50 check (large_adjustment_percent > 0),
  expiry_warning_days integer not null default 30 check (expiry_warning_days between 1 and 365),
  auto_send_purchase_orders boolean not null default false,
  ai_auto_apply_min_confidence numeric(4,3) not null default 0.950
    check (ai_auto_apply_min_confidence between 0.5 and 1),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger businesses_updated_at before update on public.businesses
  for each row execute function app.set_updated_at();

create table public.business_locations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  address text check (char_length(address) <= 500),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, name)
);
create unique index business_locations_one_primary
  on public.business_locations (business_id) where is_primary;
create index business_locations_business_idx on public.business_locations (business_id);
create trigger business_locations_updated_at before update on public.business_locations
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text check (char_length(full_name) <= 120),
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function app.set_updated_at();

create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 120)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- ---------------------------------------------------------------------------
-- Membership
-- ---------------------------------------------------------------------------
create table public.business_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null,
  status public.member_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, user_id)
);
create index business_members_user_idx on public.business_members (user_id);
create trigger business_members_updated_at before update on public.business_members
  for each row execute function app.set_updated_at();

create table public.business_invitations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role public.member_role not null check (role <> 'owner'),
  -- Only a SHA-256 hash of the invite token is stored.
  token_hash text not null unique,
  invited_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index business_invitations_business_idx on public.business_invitations (business_id);

-- ---------------------------------------------------------------------------
-- RBAC helpers used by RLS policies and functions.
-- SECURITY DEFINER so they can read business_members without recursing
-- through its own RLS policies.
-- ---------------------------------------------------------------------------
create or replace function app.member_role(p_business_id uuid)
returns public.member_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.business_members m
  where m.business_id = p_business_id
    and m.user_id = auth.uid()
    and m.status = 'active';
$$;

create or replace function app.is_member(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.member_role(p_business_id) is not null;
$$;

-- True when the caller holds at least p_min_role (owner > manager > employee).
create or replace function app.has_role(p_business_id uuid, p_min_role public.member_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    case app.member_role(p_business_id)
      when 'owner' then true
      when 'manager' then p_min_role in ('manager', 'employee')
      when 'employee' then p_min_role = 'employee'
    end,
    false
  );
$$;

-- Raises unless the caller holds at least p_min_role. Returns the role.
create or replace function app.require_role(p_business_id uuid, p_min_role public.member_role)
returns public.member_role
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.member_role;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  v_role := app.member_role(p_business_id);
  if v_role is null or not app.has_role(p_business_id, p_min_role) then
    raise exception 'forbidden: requires % role', p_min_role using errcode = '42501';
  end if;
  return v_role;
end;
$$;

-- Shares-a-business check used for profile visibility.
create or replace function app.shares_business_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.business_members mine
    join public.business_members theirs on theirs.business_id = mine.business_id
    where mine.user_id = auth.uid() and mine.status = 'active'
      and theirs.user_id = p_user_id
  );
$$;

grant execute on function app.member_role(uuid), app.is_member(uuid),
  app.has_role(uuid, public.member_role), app.shares_business_with(uuid)
  to authenticated, service_role;

-- Keep at least one active owner in every business.
create or replace function app.guard_last_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := coalesce(old.business_id, new.business_id);
begin
  if current_setting('app.purge', true) = 'on' then
    return coalesce(new, old);
  end if;
  if old.role = 'owner' and old.status = 'active'
     and (tg_op = 'DELETE' or new.role <> 'owner' or new.status <> 'active') then
    if not exists (
      select 1 from public.business_members
      where business_id = v_business and role = 'owner' and status = 'active' and id <> old.id
    ) then
      raise exception 'last_owner: a business must keep at least one active owner' using errcode = 'P0001';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;
create trigger business_members_guard_last_owner
  before update or delete on public.business_members
  for each row execute function app.guard_last_owner();

-- ---------------------------------------------------------------------------
-- Activity log (immutable)
-- ---------------------------------------------------------------------------
create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null check (char_length(action) <= 80),
  entity_type text check (char_length(entity_type) <= 60),
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index activity_logs_business_created_idx on public.activity_logs (business_id, created_at desc);
create trigger activity_logs_immutable before update or delete on public.activity_logs
  for each row execute function app.prevent_mutation('actor_id');

create or replace function app.log_activity(
  p_business_id uuid, p_action text, p_entity_type text, p_entity_id uuid, p_metadata jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.activity_logs (business_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_business_id, auth.uid(), p_action, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb));
$$;

-- ---------------------------------------------------------------------------
-- Onboarding RPCs
-- ---------------------------------------------------------------------------
create or replace function public.create_business(
  p_name text,
  p_business_type text default 'retail',
  p_currency text default 'USD',
  p_timezone text default 'UTC',
  p_location_name text default 'Main store'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_business uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  -- Abuse guard: a single account may create a bounded number of businesses.
  if (select count(*) from public.businesses where created_by = v_uid) >= 10 then
    raise exception 'limit_reached: too many businesses for this account' using errcode = 'P0001';
  end if;

  insert into public.businesses (name, business_type, currency, timezone, created_by)
  values (trim(p_name), p_business_type, upper(p_currency), p_timezone, v_uid)
  returning id into v_business;

  insert into public.business_members (business_id, user_id, role)
  values (v_business, v_uid, 'owner');

  insert into public.business_locations (business_id, name, is_primary)
  values (v_business, coalesce(nullif(trim(p_location_name), ''), 'Main store'), true);

  perform app.log_activity(v_business, 'business.created', 'business', v_business, '{}'::jsonb);
  return v_business;
end;
$$;

create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_inv public.business_invitations;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select email into v_email from auth.users where id = v_uid;

  select * into v_inv
  from public.business_invitations
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  for update;

  if v_inv.id is null or v_inv.accepted_at is not null or v_inv.expires_at < now() then
    raise exception 'invalid_invitation' using errcode = 'P0001';
  end if;
  if lower(v_inv.email) <> lower(coalesce(v_email, '')) then
    raise exception 'invitation_email_mismatch' using errcode = '42501';
  end if;

  insert into public.business_members (business_id, user_id, role)
  values (v_inv.business_id, v_uid, v_inv.role)
  on conflict (business_id, user_id) do update set role = excluded.role, status = 'active';

  update public.business_invitations
  set accepted_at = now(), accepted_by = v_uid
  where id = v_inv.id;

  perform app.log_activity(v_inv.business_id, 'member.joined', 'business_member', v_uid,
    jsonb_build_object('role', v_inv.role));
  return v_inv.business_id;
end;
$$;

-- Owner creates an invitation; the raw token is returned exactly once and only
-- its hash is persisted.
create or replace function public.create_invitation(
  p_business_id uuid, p_email text, p_role public.member_role
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  perform app.require_role(p_business_id, 'owner');
  if p_role = 'owner' then
    raise exception 'invalid_role: owners cannot be invited' using errcode = '22023';
  end if;
  if (select count(*) from public.business_invitations
      where business_id = p_business_id and accepted_at is null and expires_at > now()) >= 50 then
    raise exception 'limit_reached: too many open invitations' using errcode = 'P0001';
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.business_invitations (business_id, email, role, token_hash, invited_by)
  values (p_business_id, lower(trim(p_email)), p_role,
          encode(extensions.digest(v_token, 'sha256'), 'hex'), auth.uid());

  perform app.log_activity(p_business_id, 'member.invited', 'business_invitation', null,
    jsonb_build_object('email', lower(trim(p_email)), 'role', p_role));
  return v_token;
end;
$$;

revoke all on function public.create_invitation(uuid, text, public.member_role) from public, anon;
grant execute on function public.create_invitation(uuid, text, public.member_role) to authenticated;
revoke all on function public.create_business(text, text, text, text, text) from public, anon;
revoke all on function public.accept_invitation(text) from public, anon;
grant execute on function public.create_business(text, text, text, text, text) to authenticated;
grant execute on function public.accept_invitation(text) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.businesses enable row level security;
alter table public.business_locations enable row level security;
alter table public.profiles enable row level security;
alter table public.business_members enable row level security;
alter table public.business_invitations enable row level security;
alter table public.activity_logs enable row level security;

revoke all on public.businesses, public.business_locations, public.profiles,
  public.business_members, public.business_invitations, public.activity_logs from anon, authenticated;

grant select on public.businesses to authenticated;
grant update (name, business_type, currency, timezone, large_adjustment_units, large_adjustment_percent,
  expiry_warning_days, auto_send_purchase_orders, ai_auto_apply_min_confidence)
  on public.businesses to authenticated;
create policy businesses_select on public.businesses for select to authenticated
  using (app.is_member(id));
create policy businesses_update on public.businesses for update to authenticated
  using (app.has_role(id, 'owner')) with check (app.has_role(id, 'owner'));

grant select, insert, update, delete on public.business_locations to authenticated;
create policy locations_select on public.business_locations for select to authenticated
  using (app.is_member(business_id));
create policy locations_write on public.business_locations for all to authenticated
  using (app.has_role(business_id, 'manager')) with check (app.has_role(business_id, 'manager'));

grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or app.shares_business_with(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

grant select, delete on public.business_members to authenticated;
grant update (role, status) on public.business_members to authenticated;
create policy members_select on public.business_members for select to authenticated
  using (app.is_member(business_id));
create policy members_update on public.business_members for update to authenticated
  using (app.has_role(business_id, 'owner')) with check (app.has_role(business_id, 'owner'));
create policy members_delete on public.business_members for delete to authenticated
  using (app.has_role(business_id, 'owner') or user_id = auth.uid());

grant select, delete on public.business_invitations to authenticated;
create policy invitations_select on public.business_invitations for select to authenticated
  using (app.has_role(business_id, 'manager'));
create policy invitations_delete on public.business_invitations for delete to authenticated
  using (app.has_role(business_id, 'owner'));

grant select, insert on public.activity_logs to authenticated;
create policy activity_select on public.activity_logs for select to authenticated
  using (app.has_role(business_id, 'manager'));
create policy activity_insert on public.activity_logs for insert to authenticated
  with check (app.is_member(business_id) and actor_id = auth.uid());
