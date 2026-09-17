-- =====================================================================
-- P3：現場報到 / 簽退
-- 所有寫入都經由 RPC，前端不直接寫 attendance_logs。
-- =====================================================================

-- 報到畫面用的人員資料
create or replace function public.attendance_payload(p_reg uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'registration_id', r.id,
    'participant_id', p.id,
    'code', p.code,
    'name', p.name,
    'team', r.team,
    'extra', p.extra || r.extra,
    'checked_in_at', r.checked_in_at,
    'checked_out_at', r.checked_out_at
  )
  from public.registrations r
  join public.participants p on p.id = r.participant_id
  where r.id = p_reg;
$$;

-- ---------------------------------------------------------------------
-- 主要動作
--
-- 回傳 status：
--   ok               成功
--   already_in       已報到（附上時間與操作者）
--   already_out      已簽退
--   not_checked_in   簽退時尚未報到
--   too_soon         未達最短停留時間，需 p_force 才能簽退
--   not_in_roster    人找得到，但不在這個子活動名單
--   unknown_qr       完全查無此碼
--   checkout_off     這個子活動沒有開啟簽退
--   empty / event_missing / unauthorized
-- ---------------------------------------------------------------------
create or replace function public.perform_attendance(
  p_sub_event_id  uuid,
  p_qr            text,
  p_type          attendance_type,
  p_method        attendance_method default 'scan',
  p_client_event_id text default null,
  p_device_label  text default null,
  p_force         boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_role    user_role := public.my_role();
  v_event   public.sub_events%rowtype;
  v_person  public.participants%rowtype;
  v_reg     public.registrations%rowtype;
  v_log     public.attendance_logs%rowtype;
  v_key     text := btrim(coalesce(p_qr, ''));
  v_prev_at timestamptz;
  v_prev_by text;
  v_minutes numeric;
begin
  if v_role is null then
    return jsonb_build_object('status', 'unauthorized');
  end if;

  if v_key = '' then
    return jsonb_build_object('status', 'empty');
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

  -- 先用 QR 內容找，再退回用編號找
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
    if v_reg.checked_in_at is not null then
      select l.occurred_at, u.display_name into v_prev_at, v_prev_by
        from public.attendance_logs l
        left join public.app_users u on u.id = l.operator_id
       where l.registration_id = v_reg.id
         and l.type = 'in'
         and l.revoked_at is null
       limit 1;

      return public.attendance_payload(v_reg.id)
             || jsonb_build_object(
                  'status', 'already_in',
                  'previous_at', coalesce(v_prev_at, v_reg.checked_in_at),
                  'previous_by', v_prev_by
                );
    end if;

    begin
      insert into public.attendance_logs
        (registration_id, type, method, operator_id, device_label, client_event_id)
      values
        (v_reg.id, 'in', p_method, v_uid, p_device_label, p_client_event_id);
    exception when unique_violation then
      -- 另一台裝置同時掃到同一人
      return public.attendance_payload(v_reg.id)
             || jsonb_build_object('status', 'already_in');
    end;

    update public.registrations
       set checked_in_at = now()
     where id = v_reg.id;

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

  if v_reg.checked_out_at is not null then
    return public.attendance_payload(v_reg.id)
           || jsonb_build_object('status', 'already_out');
  end if;

  v_minutes := extract(epoch from (now() - v_reg.checked_in_at)) / 60.0;

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

  begin
    insert into public.attendance_logs
      (registration_id, type, method, operator_id, device_label, client_event_id)
    values
      (v_reg.id, 'out', p_method, v_uid, p_device_label, p_client_event_id);
  exception when unique_violation then
    return public.attendance_payload(v_reg.id)
           || jsonb_build_object('status', 'already_out');
  end;

  update public.registrations
     set checked_out_at = now()
   where id = v_reg.id;

  return public.attendance_payload(v_reg.id) || jsonb_build_object('status', 'ok');
end $$;

-- ---------------------------------------------------------------------
-- 撤銷一筆紀錄（註冊長以上）
-- ---------------------------------------------------------------------
create or replace function public.revoke_attendance(
  p_log_id uuid,
  p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_log public.attendance_logs%rowtype;
begin
  if not public.is_lead_up() then
    return jsonb_build_object('status', 'forbidden');
  end if;

  select * into v_log from public.attendance_logs where id = p_log_id;
  if not found or v_log.revoked_at is not null then
    return jsonb_build_object('status', 'not_found');
  end if;

  update public.attendance_logs
     set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = p_reason
   where id = p_log_id;

  -- 撤銷報到時，連帶清掉簽退（沒有報到就不該有簽退）
  if v_log.type = 'in' then
    update public.attendance_logs
       set revoked_at = now(), revoked_by = auth.uid(),
           revoke_reason = coalesce(p_reason, '') || '（連動：報到已撤銷）'
     where registration_id = v_log.registration_id
       and type = 'out'
       and revoked_at is null;

    update public.registrations
       set checked_in_at = null, checked_out_at = null
     where id = v_log.registration_id;
  else
    update public.registrations
       set checked_out_at = null
     where id = v_log.registration_id;
  end if;

  return jsonb_build_object('status', 'ok');
end $$;

grant execute on function public.attendance_payload(uuid) to authenticated;
grant execute on function public.perform_attendance(uuid, text, attendance_type, attendance_method, text, text, boolean) to authenticated;
grant execute on function public.revoke_attendance(uuid, text) to authenticated;
