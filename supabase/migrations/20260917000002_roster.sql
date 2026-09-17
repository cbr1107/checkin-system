-- =====================================================================
-- P2：名單匯入前置調整
-- 編號改以「正規化後（去空白、轉大寫）原樣儲存」，並改用一般唯一約束，
-- 讓 upsert (on conflict) 可以直接使用 code 欄位。
-- =====================================================================

-- 既有資料正規化（新專案通常為空表）
update public.participants set code = upper(btrim(code));

drop index if exists public.participants_code_key;

alter table public.participants
  drop constraint if exists participants_code_unique;

alter table public.participants
  add constraint participants_code_unique unique (code);

-- 匯入時常用的查詢：以 QR 內容找人
create index if not exists participants_qr_lookup_idx on public.participants (qr_code);
