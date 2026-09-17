-- =====================================================================
-- P5：統計、紀錄管理、系統設定
-- =====================================================================

-- ---------------------------------------------------------------------
-- 子活動統計檢視
-- 原本列表頁是把所有 registrations 撈回前端再數，資料一多就明顯變慢。
-- 改由資料庫聚合，只回傳每個活動一列。
-- security_invoker 讓檢視沿用查詢者的 RLS。
-- ---------------------------------------------------------------------
create or replace view public.sub_event_stats
with (security_invoker = on) as
select
  e.id                                   as sub_event_id,
  count(r.id)                            as total,
  count(r.checked_in_at)                 as checked_in,
  count(r.checked_out_at)                as checked_out,
  count(r.checked_in_at) - count(r.checked_out_at) as present
from public.sub_events e
left join public.registrations r on r.sub_event_id = e.id
group by e.id;

grant select on public.sub_event_stats to authenticated;

-- ---------------------------------------------------------------------
-- 即時儀表板需要 attendance_logs 的變更推播
-- ---------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.attendance_logs;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

-- ---------------------------------------------------------------------
-- 系統設定：離線報到開關
-- ---------------------------------------------------------------------
insert into public.app_settings (key, value)
values ('offline_checkin', '{"enabled": true}'::jsonb)
on conflict (key) do nothing;

-- 報到紀錄查詢常用排序
create index if not exists attendance_logs_time_idx
  on public.attendance_logs (occurred_at desc);
