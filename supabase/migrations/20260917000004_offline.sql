-- =====================================================================
-- P4：離線佇列支援
--
-- 兩件事：
-- 1. 事件時間改由前端提供（離線時是掃碼當下的時間，不是同步上來的時間）
-- 2. 同一人同一動作若有多筆，以「最早發生」者為正式紀錄，
--    其餘保留為重複紀錄（duplicate_of），不丟棄也不覆蓋
-- =====================================================================

alter table public.attendance_logs
  add column if not exists duplicate_of uuid references public.attendance_logs(id) on delete set null;

create index if not exists attendance_logs_duplicate_idx
  on public.attendance_logs (duplicate_of)
  where duplicate_of is not null;

-- 正式紀錄的唯一性：未撤銷、且不是重複紀錄
drop index if exists public.attendance_logs_active_key;
create unique index attendance_logs_active_key
  on public.attendance_logs (registration_id, type)
  where revoked_at is null and duplicate_of is null;

-- ---------------------------------------------------------------------
-- 重建主函式（新增 p_occurred_at）
-- ---------------------------------------------------------------------
drop function if exists public.perform_attendance(uuid, text, attendance_type, attendance_method, text, text, boolean);

create or replace function public.perform_attendance(
  p_sub_event_id  uuid,
  p_qr            text,
  p_type          attendance_type,
  p_method        attendance_method default 'scan',
  p_client_event_id text default null,
  p_device_label  text default null,
  p_force         boolean default false,
  p_occurred_at   timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_role    user_role := public.my_role();
  v_event   public.sub_events%rowtype;
  v_person  public.participants%rowtype;
  v_reg     public.registrations%rowtype;
  v_log     public.attendance_logs%rowtype;
  v_active  public.attendance_logs%rowtype;
  v_key     text := btrim(coalesce(p_qr, ''));
  v_when    timestamptz := coalesce(p_occurred_at, now());
  v_new_id  uuid := gen_random_uuid();
  v_prev_by text;
  v_minutes numeric;
begin
  if v_role is null then
    return jsonb_build_object('status', 'unauthorized');
  end if;

  if v_key = '' then
    return jsonb_build_object('status', 'empty');
  end if;

  -- 前端時鐘可能有偏差；不允許把事件記在未來
  if v_when > now() then
    v_when := now();
  end if;

  select * into v_event from public.sub_events where id = p_sub_event_id;
  if not found then
    return jsonb_build_object('status', 'event_missing');
  end if;

  -- 離線佇列重送：同一個 client_event_id 只會成立一次
  if p_client_event_id is not null then
    select * into v_log
      from public.attendance_logs
     where client_event_id = p_client_event_id;
    if found then
      return public.attendance_payload(v_log.registration_id)
             || jsonb_build_object('status', 'ok', 'replayed', true);
    end if;
  end if;

  select * into v_person
    from public.participants
   where qr_code = v_key or code = upper(v_key)
   limit 1;

  if not found then
    return jsonb_build_object('status', 'unknown_qr', 'scanned', v_key);
  end if;

  select * into v_reg
    from public.registrations
   where sub_event_id = p_sub_event_id
     and participant_id = v_person.id;

  if not found then
    return jsonb_build_object(
      'status', 'not_in_roster',
      'code', v_person.code,
      'name', v_person.name,
      'participant_id', v_person.id
    );
  end if;

  -- ---------------- 報到 ----------------
  if p_type = 'in' then
    select * into v_active
      from public.attendance_logs
     where registration_id = v_reg.id
       and type = 'in'
       and revoked_at is null
       and duplicate_of is null
     for update;

    if found then
      if v_when < v_active.occurred_at then
        -- 離線裝置的紀錄比較早：既有紀錄降為重複，改以這筆為準
        update public.attendance_logs set duplicate_of = v_new_id where id = v_active.id;

        insert into public.attendance_logs
          (id, registration_id, type, method, operator_id, device_label,
           client_event_id, occurred_at)
        values
          (v_new_id, v_reg.id, 'in', p_method, v_uid, p_device_label,
           p_client_event_id, v_when);

        update public.registrations set checked_in_at = v_when where id = v_reg.id;

        return public.attendance_payload(v_reg.id)
               || jsonb_build_object('status', 'ok', 'adjusted', true);
      end if;

      -- 既有紀錄較早：這筆保留為重複紀錄
      insert into public.attendance_logs
        (id, registration_id, type, method, operator_id, device_label,
         client_event_id, occurred_at, duplicate_of)
      values
        (v_new_id, v_reg.id, 'in', p_method, v_uid, p_device_label,
         p_client_event_id, v_when, v_active.id);

      select u.display_name into v_prev_by
        from public.app_users u where u.id = v_active.operator_id;

      return public.attendance_payload(v_reg.id)
             || jsonb_build_object(
                  'status', 'already_in',
                  'previous_at', v_active.occurred_at,
                  'previous_by', v_prev_by
                );
    end if;

    insert into public.attendance_logs
      (id, registration_id, type, method, operator_id, device_label,
       client_event_id, occurred_at)
    values
      (v_new_id, v_reg.id, 'in', p_method, v_uid, p_device_label,
       p_client_event_id, v_when);

    update public.registrations set checked_in_at = v_when where id = v_reg.id;

    return public.attendance_payload(v_reg.id) || jsonb_build_object('status', 'ok');
  end if;

  -- ---------------- 簽退 ----------------
  if not v_event.require_checkout then
    return jsonb_build_object('status', 'checkout_off');
  end if;

  if v_reg.checked_in_at is null then
    return public.attendance_payload(v_reg.id)
           || jsonb_build_object('status', 'not_checked_in');
  end if;

  v_minutes := extract(epoch from (v_when - v_reg.checked_in_at)) / 60.0;

  if not p_force
     and v_event.min_stay_minutes > 0
     and v_minutes < v_event.min_stay_minutes then
    return public.attendance_payload(v_reg.id)
           || jsonb_build_object(
                'status', 'too_soon',
                'minutes_elapsed', round(v_minutes, 1),
                'min_stay_minutes', v_event.min_stay_minutes
              );
  end if;

  select * into v_active
    from public.attendance_logs
   where registration_id = v_reg.id
     and type = 'out'
     and revoked_at is null
     and duplicate_of is null
   for update;

  if found then
    if v_when < v_active.occurred_at then
      update public.attendance_logs set duplicate_of = v_new_id where id = v_active.id;

      insert into public.attendance_logs
        (id, registration_id, type, method, operator_id, device_label,
         client_event_id, occurred_at)
      values
        (v_new_id, v_reg.id, 'out', p_method, v_uid, p_device_label,
         p_client_event_id, v_when);

      update public.registrations set checked_out_at = v_when where id = v_reg.id;

      return public.attendance_payload(v_reg.id)
             || jsonb_build_object('status', 'ok', 'adjusted', true);
    end if;

    insert into public.attendance_logs
      (id, registration_id, type, method, operator_id, device_label,
       client_event_id, occurred_at, duplicate_of)
    values
      (v_new_id, v_reg.id, 'out', p_method, v_uid, p_device_label,
       p_client_event_id, v_when, v_active.id);

    return public.attendance_payload(v_reg.id)
           || jsonb_build_object('status', 'already_out');
  end if;

  insert into public.attendance_logs
    (id, registration_id, type, method, operator_id, device_label,
     client_event_id, occurred_at)
  values
    (v_new_id, v_reg.id, 'out', p_method, v_uid, p_device_label,
     p_client_event_id, v_when);

  update public.registrations set checked_out_at = v_when where id = v_reg.id;

  return public.attendance_payload(v_reg.id) || jsonb_build_object('status', 'ok');
end $$;

grant execute on function public.perform_attendance(uuid, text, attendance_type, attendance_method, text, text, boolean, timestamptz) to authenticated;
