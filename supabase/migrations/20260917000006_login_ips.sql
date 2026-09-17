-- =====================================================================
-- 帳號可登入的 IP 數量限制
-- max_ips = 0 表示不限制（預設）
-- =====================================================================

alter table public.app_users
  add column if not exists max_ips integer not null default 0
  check (max_ips >= 0);

create table if not exists public.login_ips (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.app_users(id) on delete cascade,
  ip          text not null,
  user_agent  text,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  unique (user_id, ip)
);

create index if not exists login_ips_user_idx
  on public.login_ips (user_id, last_seen desc);

alter table public.login_ips enable row level security;

-- 本人看得到自己的紀錄，註冊組員以上看得到全部；寫入一律走服務端
drop policy if exists login_ips_select on public.login_ips;
create policy login_ips_select on public.login_ips for select to authenticated
  using (public.is_staff_up() or user_id = auth.uid());

grant select on public.login_ips to authenticated;
