-- =====================================================================
-- 註冊作業中心
-- =====================================================================

-- 子活動可選擇開放給所有註冊組員，不必逐一授權
alter table public.sub_events
  add column if not exists open_to_all_staff boolean not null default false;

-- 哪些身分能進入註冊作業中心，由系統管理員設定
insert into public.app_settings (key, value)
values ('registration_center', '{"roles": ["admin", "lead"]}'::jsonb)
on conflict (key) do nothing;

-- 名單編輯權限：加入「開放全部組員」這條路徑
create or replace function public.can_edit_roster(target uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_lead_up()
      or (
        public.my_role() = 'staff'
        and (
          exists (
            select 1 from public.sub_event_grants g
            where g.sub_event_id = target
              and g.user_id = auth.uid()
              and g.can_edit_roster
          )
          or exists (
            select 1 from public.sub_events e
            where e.id = target and e.open_to_all_staff
          )
        )
      );
$$;
