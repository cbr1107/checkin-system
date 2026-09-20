-- =====================================================================
-- 掃碼登入：每個帳號一組識別金鑰
-- =====================================================================

alter table public.app_users
  add column if not exists login_key text,
  add column if not exists qr_login_enabled boolean not null default true;

-- 既有帳號補發金鑰（26 碼，含大小寫字母、數字與符號）
update public.app_users
   set login_key = substr(
         translate(encode(gen_random_bytes(24), 'base64'), '/=', '$#'),
         1, 26
       )
 where login_key is null;

alter table public.app_users
  alter column login_key set not null;

create unique index if not exists app_users_login_key_uidx
  on public.app_users (login_key);

-- 金鑰等同免密碼登入憑證：任何一般查詢都不得讀到這個欄位，
-- 只有服務端（service_role）與管理 API 能取用。
revoke select (login_key) on public.app_users from authenticated;
revoke select (login_key) on public.app_users from anon;

-- 全域開關
insert into public.app_settings (key, value)
values ('qr_login', '{"enabled": true}'::jsonb)
on conflict (key) do nothing;
