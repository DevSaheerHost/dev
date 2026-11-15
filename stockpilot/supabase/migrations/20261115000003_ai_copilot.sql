-- StockPilot AI — Voice/photo capture, AI extractions and the human review queue.
--
-- Nothing an AI proposes touches stock directly. Proposals land in
-- ai_review_queue and are applied only through public.apply_review_item,
-- which re-checks role requirements and uses the stock engine's idempotency.

create table public.voice_sessions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  audit_id uuid references public.inventory_audits (id) on delete set null,
  status text not null default 'transcribed'
    check (status in ('recording', 'transcribed', 'extracted', 'applied', 'cancelled')),
  audio_path text check (char_length(audio_path) <= 300),
  duration_ms integer check (duration_ms between 0 and 600000),
  -- Client-generated id so an offline draft replayed twice is stored once.
  client_draft_id text check (char_length(client_draft_id) <= 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index voice_sessions_draft_uniq on public.voice_sessions (business_id, client_draft_id)
  where client_draft_id is not null;
create index voice_sessions_business_idx on public.voice_sessions (business_id, created_at desc);
create trigger voice_sessions_updated_at before update on public.voice_sessions
  for each row execute function app.set_updated_at();

create table public.voice_transcriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  voice_session_id uuid not null references public.voice_sessions (id) on delete cascade,
  text text not null check (char_length(text) between 1 and 5000),
  provider text not null check (provider in ('browser', 'gemini', 'manual')),
  language text check (char_length(language) <= 16),
  confidence numeric(4,3) check (confidence is null or confidence between 0 and 1),
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index voice_transcriptions_session_idx on public.voice_transcriptions (voice_session_id);

create table public.photo_audits (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  audit_id uuid references public.inventory_audits (id) on delete set null,
  mode text not null check (mode in ('shelf', 'packing_slip', 'damage', 'expiry_label')),
  image_path text not null check (char_length(image_path) <= 300),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'uploaded' check (status in ('uploaded', 'analyzed', 'failed', 'applied')),
  client_draft_id text check (char_length(client_draft_id) <= 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index photo_audits_draft_uniq on public.photo_audits (business_id, client_draft_id)
  where client_draft_id is not null;
create index photo_audits_business_idx on public.photo_audits (business_id, created_at desc);
create trigger photo_audits_updated_at before update on public.photo_audits
  for each row execute function app.set_updated_at();

create table public.ai_extractions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  source_type text not null check (source_type in ('voice', 'photo')),
  voice_session_id uuid references public.voice_sessions (id) on delete cascade,
  photo_audit_id uuid references public.photo_audits (id) on delete cascade,
  provider text not null check (char_length(provider) <= 40),
  model text check (char_length(model) <= 80),
  prompt_version text not null check (char_length(prompt_version) <= 20),
  raw_output jsonb,
  validated_output jsonb,
  is_valid boolean not null,
  validation_error text check (char_length(validation_error) <= 2000),
  overall_confidence numeric(4,3) check (overall_confidence is null or overall_confidence between 0 and 1),
  clarification_questions jsonb not null default '[]'::jsonb,
  latency_ms integer,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((source_type = 'voice' and voice_session_id is not null)
      or (source_type = 'photo' and photo_audit_id is not null))
);
create index ai_extractions_business_idx on public.ai_extractions (business_id, created_at desc);
create trigger ai_extractions_immutable before update or delete on public.ai_extractions
  for each row execute function app.prevent_mutation('created_by');

create table public.ai_review_queue (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  extraction_id uuid not null references public.ai_extractions (id) on delete cascade,
  source_type text not null check (source_type in ('voice', 'photo')),
  action_index integer not null check (action_index between 0 and 99),
  -- The validated AI action, verbatim.
  proposed jsonb not null,
  spoken_product text check (char_length(spoken_product) <= 300),
  matched_product_id uuid references public.products (id) on delete set null,
  match_confidence numeric(4,3) check (match_confidence is null or match_confidence between 0 and 1),
  match_candidates jsonb not null default '[]'::jsonb,
  ai_confidence numeric(4,3) check (ai_confidence is null or ai_confidence between 0 and 1),
  movement_type public.movement_type,
  input_quantity numeric(14,3),
  input_unit text check (char_length(input_unit) <= 32),
  base_quantity numeric(14,3),
  quantity_kind text not null default 'confirmed'
    check (quantity_kind in ('confirmed', 'visible', 'estimated')),
  expiry_date date,
  batch_number text check (char_length(batch_number) <= 64),
  warnings text[] not null default '{}',
  risk_level text not null default 'low' check (risk_level in ('low', 'medium', 'high')),
  requires_role public.member_role not null default 'employee',
  status text not null default 'pending'
    check (status in ('pending', 'needs_clarification', 'applied', 'rejected', 'superseded')),
  clarification_question text check (char_length(clarification_question) <= 500),
  was_edited boolean not null default false,
  reviewer_id uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (char_length(review_note) <= 500),
  applied_movement_id uuid references public.inventory_movements (id) on delete set null,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (extraction_id, action_index)
);
create index ai_review_queue_open_idx on public.ai_review_queue (business_id, status, created_at desc);
create trigger ai_review_queue_updated_at before update on public.ai_review_queue
  for each row execute function app.set_updated_at();

alter table public.inventory_movements
  add constraint inventory_movements_review_item_fk
  foreign key (review_item_id) references public.ai_review_queue (id) on delete set null;
-- (The movement ledger's immutability guard permits exactly this set-null.)

create or replace function app.review_item_same_business()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.ai_extractions where id = new.extraction_id and business_id = new.business_id)
     or (new.matched_product_id is not null and not exists
         (select 1 from public.products where id = new.matched_product_id and business_id = new.business_id)) then
    raise exception 'cross_tenant_reference' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and new.requires_role <> 'employee' then
    perform app.notify(new.business_id, 'ai_review', 'info', 'AI change needs approval',
      coalesce(new.spoken_product, 'An inventory change') || ' — review before it is applied.',
      '/review', 'ai_review:' || new.id::text, 'manager');
  end if;
  return new;
end;
$$;
create trigger ai_review_queue_same_business before insert or update on public.ai_review_queue
  for each row execute function app.review_item_same_business();

-- Apply (optionally edited) review item atomically.
create or replace function public.apply_review_item(
  p_item_id uuid,
  p_product_id uuid,
  p_movement_type public.movement_type,
  p_base_quantity numeric,
  p_input_quantity numeric default null,
  p_input_unit text default null,
  p_batch_id uuid default null,
  p_batch_number text default null,
  p_expiry_date date default null,
  p_reason text default null,
  p_observed_at timestamptz default null,
  p_audit_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.ai_review_queue;
  v_role public.member_role;
  v_result jsonb;
  v_edited boolean;
begin
  select * into v_item from public.ai_review_queue where id = p_item_id for update;
  if v_item.id is null then
    raise exception 'review_item_not_found' using errcode = 'P0002';
  end if;
  v_role := app.require_role(v_item.business_id, 'employee');

  if v_item.status = 'applied' then
    return (select to_jsonb(m) || jsonb_build_object('duplicate', true)
            from public.inventory_movements m where m.id = v_item.applied_movement_id);
  end if;
  if v_item.status not in ('pending', 'needs_clarification') then
    raise exception 'review_item_closed: status is %', v_item.status using errcode = 'P0001';
  end if;
  if not app.has_role(v_item.business_id, v_item.requires_role) then
    raise exception 'approval_required: a % must approve this change', v_item.requires_role
      using errcode = '42501';
  end if;
  if v_role = 'employee' and v_item.created_by <> auth.uid() then
    raise exception 'forbidden: employees may only confirm their own audits' using errcode = '42501';
  end if;

  v_edited := p_product_id is distinct from v_item.matched_product_id
           or p_movement_type is distinct from v_item.movement_type
           or p_base_quantity is distinct from v_item.base_quantity;

  v_result := app.apply_stock_movement_internal(
    v_item.business_id, p_product_id, p_movement_type, p_base_quantity,
    v_item.source_type::public.movement_source, 'review:' || v_item.id::text, auth.uid(), v_role,
    coalesce(p_reason, 'AI ' || v_item.source_type || ' audit'), p_batch_id, p_batch_number,
    coalesce(p_expiry_date, v_item.expiry_date), null, p_input_quantity, p_input_unit,
    v_item.ai_confidence, v_item.id,
    case when v_role in ('owner', 'manager') then auth.uid() else null end,
    p_audit_id, null, p_observed_at, null
  );

  update public.ai_review_queue
  set status = 'applied', was_edited = v_edited, reviewer_id = auth.uid(), reviewed_at = now(),
      applied_movement_id = (v_result ->> 'id')::uuid,
      matched_product_id = p_product_id, movement_type = p_movement_type, base_quantity = p_base_quantity
  where id = v_item.id;

  return v_result;
end;
$$;

create or replace function public.reject_review_item(p_item_id uuid, p_note text default null, p_superseded boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.ai_review_queue;
begin
  select * into v_item from public.ai_review_queue where id = p_item_id for update;
  if v_item.id is null then
    raise exception 'review_item_not_found' using errcode = 'P0002';
  end if;
  perform app.require_role(v_item.business_id, 'employee');
  if v_item.created_by <> auth.uid() and not app.has_role(v_item.business_id, 'manager') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_item.status not in ('pending', 'needs_clarification') then
    raise exception 'review_item_closed: status is %', v_item.status using errcode = 'P0001';
  end if;
  update public.ai_review_queue
  set status = case when p_superseded then 'superseded' else 'rejected' end,
      reviewer_id = auth.uid(), reviewed_at = now(), review_note = left(p_note, 500)
  where id = p_item_id;
end;
$$;

revoke all on function public.apply_review_item(uuid, uuid, public.movement_type, numeric, numeric, text,
  uuid, text, date, text, timestamptz, uuid) from public, anon;
grant execute on function public.apply_review_item(uuid, uuid, public.movement_type, numeric, numeric, text,
  uuid, text, date, text, timestamptz, uuid) to authenticated;
revoke all on function public.reject_review_item(uuid, text, boolean) from public, anon;
grant execute on function public.reject_review_item(uuid, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.voice_sessions enable row level security;
alter table public.voice_transcriptions enable row level security;
alter table public.photo_audits enable row level security;
alter table public.ai_extractions enable row level security;
alter table public.ai_review_queue enable row level security;

revoke all on public.voice_sessions, public.voice_transcriptions, public.photo_audits,
  public.ai_extractions, public.ai_review_queue from anon, authenticated;

grant select, insert on public.voice_sessions, public.voice_transcriptions, public.photo_audits,
  public.ai_extractions to authenticated;
grant update (status) on public.voice_sessions, public.photo_audits to authenticated;

create policy voice_sessions_select on public.voice_sessions for select to authenticated
  using (app.is_member(business_id) and (user_id = auth.uid() or app.has_role(business_id, 'manager')));
create policy voice_sessions_insert on public.voice_sessions for insert to authenticated
  with check (app.is_member(business_id) and user_id = auth.uid());
create policy voice_sessions_update on public.voice_sessions for update to authenticated
  using (user_id = auth.uid() and app.is_member(business_id)) with check (user_id = auth.uid());

create policy voice_transcriptions_select on public.voice_transcriptions for select to authenticated
  using (app.is_member(business_id) and (created_by = auth.uid() or app.has_role(business_id, 'manager')));
create policy voice_transcriptions_insert on public.voice_transcriptions for insert to authenticated
  with check (app.is_member(business_id) and created_by = auth.uid()
    and exists (select 1 from public.voice_sessions s
                where s.id = voice_session_id and s.business_id = voice_transcriptions.business_id
                  and s.user_id = auth.uid()));

create policy photo_audits_select on public.photo_audits for select to authenticated
  using (app.is_member(business_id) and (user_id = auth.uid() or app.has_role(business_id, 'manager')));
create policy photo_audits_insert on public.photo_audits for insert to authenticated
  with check (app.is_member(business_id) and user_id = auth.uid()
    and split_part(image_path, '/', 1) = business_id::text);
create policy photo_audits_update on public.photo_audits for update to authenticated
  using (user_id = auth.uid() and app.is_member(business_id)) with check (user_id = auth.uid());

create policy ai_extractions_select on public.ai_extractions for select to authenticated
  using (app.is_member(business_id) and (created_by = auth.uid() or app.has_role(business_id, 'manager')));
create policy ai_extractions_insert on public.ai_extractions for insert to authenticated
  with check (app.is_member(business_id) and created_by = auth.uid());

grant select on public.ai_review_queue to authenticated;
grant insert (business_id, extraction_id, source_type, action_index, proposed, spoken_product,
  matched_product_id, match_confidence, match_candidates, ai_confidence, movement_type, input_quantity,
  input_unit, base_quantity, quantity_kind, expiry_date, batch_number, warnings, risk_level, requires_role,
  status, clarification_question, created_by)
  on public.ai_review_queue to authenticated;
create policy review_select on public.ai_review_queue for select to authenticated
  using (app.is_member(business_id) and (created_by = auth.uid() or app.has_role(business_id, 'manager')));
create policy review_insert on public.ai_review_queue for insert to authenticated
  with check (app.is_member(business_id) and created_by = auth.uid()
    and status in ('pending', 'needs_clarification'));
