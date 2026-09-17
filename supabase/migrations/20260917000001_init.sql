-- =====================================================================
-- 現場報到系統 — 初始 schema
-- 對應規格：單層子活動、四級權限、獨立帳號、可設定簽退
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 列舉型別
-- ---------------------------------------------------------------------
do $$ begin
  create type user_role as enum ('admin', 'lead', 'staff', 'checkin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type attendance_type as enum ('in', 'out');
exception when duplicate_object then null; end $$;

do $$ begin
  create type attendance_method as enum ('scan', 'manual');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 共用觸發器：自動更新 updated_at
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 使用者（對應 auth.users，但以「帳號」而非信箱識別）
-- ---------------------------------------------------------------------
create table if not exists public.app_users (
  id                   uuid primary key references auth.users(id) on delete cascade,
  account              text not null,
  display_name         text not null,
  role                 user_role not null default 'checkin',
  is_active            boolean not null default true,
  must_change_password boolean not null default true,
  note                 text,
  created_by           uuid references public.app_users(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create unique index if not exists app_users_account_key
  on public.app_users (lower(account));
create index if not exists app_users_role_idx on public.app_users (role);

drop trigger if exists app_users_touch on public.app_users;
create trigger app_users_touch before update on public.app_users
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 子活動（單層，無母活動）
-- ---------------------------------------------------------------------
create table if not exists public.sub_events (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  description       text,
  location          text,
  starts_at         timestamptz,
  ends_at           timestamptz,
  require_checkout  boolean not null default false,
  min_stay_minutes  integer not null default 5 check (min_stay_minutes >= 0),
  display_fields    jsonb,          -- null = 沿用全域設定
  is_active         boolean not null default true,
  created_by        uuid references public.app_users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists sub_events_active_idx on public.sub_events (is_active, starts_at);

drop trigger if exists sub_events_touch on public.sub_events;
create trigger sub_events_touch before update on public.sub_events
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 人員主檔（編號全域唯一，一人一碼通行所有子活動）
-- ---------------------------------------------------------------------
create table if not exists public.participants (
  id          uuid primary key default gen_random_uuid(),
  code        text not null,        -- 編號
  qr_code     text not null,        -- QR 內容（匯入時提供，預設同編號）
  name        text not null,
  extra       jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists participants_code_key on public.participants (lower(code));
create unique index if not exists participants_qr_key   on public.participants (qr_code);
create index if not exists participants_name_idx        on public.participants (name);

drop trigger if exists participants_touch on public.participants;
create trigger participants_touch before update on public.participants
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 匯入批次
-- ---------------------------------------------------------------------
create table if not exists public.import_batches (
  id             uuid primary key default gen_random_uuid(),
  sub_event_id   uuid not null references public.sub_events(id) on delete cascade,
  filename       text,
  mapping        jsonb not null default '{}'::jsonb,
  row_count      integer not null default 0,
  created_count  integer not null default 0,
  updated_count  integer not null default 0,
  created_by     uuid references public.app_users(id) on delete set null,
  created_at     timestamptz not null default now(),
  undone_at      timestamptz,
  undone_by      uuid references public.app_users(id) on delete set null
);

create index if not exists import_batches_event_idx on public.import_batches (sub_event_id, created_at desc);

-- ---------------------------------------------------------------------
-- 參與名單（組別存這裡：同一人在不同子活動組別可不同）
-- ---------------------------------------------------------------------
create table if not exists public.registrations (
  id               uuid primary key default gen_random_uuid(),
  sub_event_id     uuid not null references public.sub_events(id) on delete cascade,
  participant_id   uuid not null references public.participants(id) on delete cascade,
  team             text,                       -- 組別
  extra            jsonb not null default '{}'::jsonb,
  checked_in_at    timestamptz,
  checked_out_at   timestamptz,
  import_batch_id  uuid references public.import_batches(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (sub_event_id, participant_id)
);

create index if not exists registrations_event_idx on public.registrations (sub_event_id);
create index if not exists registrations_team_idx  on public.registrations (sub_event_id, team);
create index if not exists registrations_state_idx on public.registrations (sub_event_id, checked_in_at, checked_out_at);

drop trigger if exists registrations_touch on public.registrations;
create trigger registrations_touch before update on public.registrations
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 出勤紀錄（報到 / 簽退，含稽核欄位）
-- ---------------------------------------------------------------------
create table if not exists public.attendance_logs (
  id               uuid primary key default gen_random_uuid(),
  registration_id  uuid not null references public.registrations(id) on delete cascade,
  type             attendance_type not null,
  method           attendance_method not null default 'scan',
  operator_id      uuid references public.app_users(id) on delete set null,
  device_label     text,
  client_event_id  text,            -- 離線佇列冪等鍵
  occurred_at      timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  revoked_at       timestamptz,
  revoked_by       uuid references public.app_users(id) on delete set null,
  revoke_reason    text
);

-- 一筆名單、一種類型，同時間只能有一筆未撤銷的紀錄
create unique index if not exists attendance_logs_active_key
  on public.attendance_logs (registration_id, type)
  where revoked_at is null;

-- 離線同步冪等：同一個 client_event_id 只會落一筆
create unique index if not exists attendance_logs_client_key
  on public.attendance_logs (client_event_id)
  where client_event_id is not null;

create index if not exists attendance_logs_operator_idx on public.attendance_logs (operator_id, occurred_at desc);
create index if not exists attendance_logs_reg_idx      on public.attendance_logs (registration_id, occurred_at desc);

-- ---------------------------------------------------------------------
-- 註冊組員的子活動授權
-- ---------------------------------------------------------------------
create table if not exists public.sub_event_grants (
  id               uuid primary key default gen_random_uuid(),
  sub_event_id     uuid not null references public.sub_events(id) on delete cascade,
  user_id          uuid not null references public.app_users(id) on delete cascade,
  can_edit_roster  boolean not null default true,
  can_export       boolean not null default false,
  granted_by       uuid references public.app_users(id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (sub_event_id, user_id)
);

-- ---------------------------------------------------------------------
-- 全域設定
-- ---------------------------------------------------------------------
create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_by  uuid references public.app_users(id) on delete set null,
  updated_at  timestamptz not null default now()
);

insert into public.app_settings (key, value) values
  ('display_fields', '{"fields":[
      {"key":"name","label":"姓名","enabled":true,"size":"xl"},
      {"key":"code","label":"編號","enabled":true,"size":"md"},
      {"key":"team","label":"組別","enabled":true,"size":"lg"}
    ]}'::jsonb)
on conflict (key) do nothing;

-- =====================================================================
-- 權限輔助函式（security definer，避免 RLS 遞迴）
-- =====================================================================
create or replace function public.my_role()
returns user_role
language sql stable security definer set search_path = public as $$
  select role from public.app_users where id = auth.uid() and is_active;
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'admin', false);
$$;

-- 註冊長以上
create or replace function public.is_lead_up()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('admin', 'lead'), false);
$$;

-- 註冊組員以上（可查看完整紀錄）
create or replace function public.is_staff_up()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('admin', 'lead', 'staff'), false);
$$;

-- 任一已啟用帳號
create or replace function public.is_member()
returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() is not null;
$$;

-- 可編輯指定子活動名單
create or replace function public.can_edit_roster(target uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_lead_up()
      or exists (
        select 1 from public.sub_event_grants g
        where g.sub_event_id = target
          and g.user_id = auth.uid()
          and g.can_edit_roster
          and public.my_role() = 'staff'
      );
$$;

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.app_users        enable row level security;
alter table public.sub_events       enable row level security;
alter table public.participants     enable row level security;
alter table public.registrations    enable row level security;
alter table public.attendance_logs  enable row level security;
alter table public.sub_event_grants enable row level security;
alter table public.import_batches   enable row level security;
alter table public.app_settings     enable row level security;

-- app_users ------------------------------------------------------------
drop policy if exists app_users_select on public.app_users;
create policy app_users_select on public.app_users for select to authenticated
  using (id = auth.uid() or public.is_staff_up());

drop policy if exists app_users_self_update on public.app_users;
create policy app_users_self_update on public.app_users for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- 建立 / 刪除 / 改角色一律走 service role（後端 API），不開放前端直寫

-- sub_events -----------------------------------------------------------
drop policy if exists sub_events_select on public.sub_events;
create policy sub_events_select on public.sub_events for select to authenticated
  using (public.is_member());

drop policy if exists sub_events_write on public.sub_events;
create policy sub_events_write on public.sub_events for all to authenticated
  using (public.is_lead_up()) with check (public.is_lead_up());

-- participants ---------------------------------------------------------
drop policy if exists participants_select on public.participants;
create policy participants_select on public.participants for select to authenticated
  using (public.is_member());

drop policy if exists participants_write on public.participants;
create policy participants_write on public.participants for all to authenticated
  using (public.is_lead_up()) with check (public.is_lead_up());

-- registrations --------------------------------------------------------
drop policy if exists registrations_select on public.registrations;
create policy registrations_select on public.registrations for select to authenticated
  using (public.is_member());

drop policy if exists registrations_insert on public.registrations;
create policy registrations_insert on public.registrations for insert to authenticated
  with check (public.can_edit_roster(sub_event_id));

drop policy if exists registrations_update on public.registrations;
create policy registrations_update on public.registrations for update to authenticated
  using (public.can_edit_roster(sub_event_id))
  with check (public.can_edit_roster(sub_event_id));

drop policy if exists registrations_delete on public.registrations;
create policy registrations_delete on public.registrations for delete to authenticated
  using (public.can_edit_roster(sub_event_id));

-- attendance_logs ------------------------------------------------------
-- 報到人員只看得到自己經手的紀錄；註冊組員以上看全部
drop policy if exists attendance_logs_select on public.attendance_logs;
create policy attendance_logs_select on public.attendance_logs for select to authenticated
  using (public.is_staff_up() or operator_id = auth.uid());

-- 寫入一律經由 RPC（P3 實作），RLS 不開放直寫
drop policy if exists attendance_logs_revoke on public.attendance_logs;
create policy attendance_logs_revoke on public.attendance_logs for update to authenticated
  using (public.is_lead_up()) with check (public.is_lead_up());

-- sub_event_grants -----------------------------------------------------
drop policy if exists sub_event_grants_select on public.sub_event_grants;
create policy sub_event_grants_select on public.sub_event_grants for select to authenticated
  using (public.is_staff_up() or user_id = auth.uid());

drop policy if exists sub_event_grants_write on public.sub_event_grants;
create policy sub_event_grants_write on public.sub_event_grants for all to authenticated
  using (public.is_lead_up()) with check (public.is_lead_up());

-- import_batches -------------------------------------------------------
drop policy if exists import_batches_select on public.import_batches;
create policy import_batches_select on public.import_batches for select to authenticated
  using (public.is_staff_up());

drop policy if exists import_batches_write on public.import_batches;
create policy import_batches_write on public.import_batches for all to authenticated
  using (public.can_edit_roster(sub_event_id))
  with check (public.can_edit_roster(sub_event_id));

-- app_settings ---------------------------------------------------------
drop policy if exists app_settings_select on public.app_settings;
create policy app_settings_select on public.app_settings for select to authenticated
  using (public.is_member());

drop policy if exists app_settings_write on public.app_settings;
create policy app_settings_write on public.app_settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- =====================================================================
-- 授權
-- =====================================================================
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role;
