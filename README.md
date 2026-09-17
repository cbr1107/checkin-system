# 現場報到系統

臺北醫學大學楓杏醫學青年服務團 — 子活動現場報到 / 簽退系統。
Next.js 14（App Router）+ Supabase。

目前版本：**v0.2.0**（P1 帳號系統、P2 子活動與名單匯入）

---

## 一、建立 Supabase 專案

1. 到 supabase.com 開一個**全新專案**（不要與義診、測驗系統共用）。
2. 進入 **Authentication → Providers → Email**：
   - 開啟 Email provider
   - **關閉 Confirm email**（系統不寄信，帳號由管理員建立）
   - 關閉 Enable email signups（不開放自行註冊）
3. 進入 **SQL Editor**，依序執行 `supabase/migrations/` 下的 SQL（`20260917000001_init.sql` → `20260917000002_roster.sql`）。
4. 到 **Project Settings → API** 抄下三個值：Project URL、anon key、service_role key。

---

## 二、本機設定

```bash
npm install
cp .env.local.example .env.local   # 填入上一步抄下的三個值
```

`NEXT_PUBLIC_ACCOUNT_EMAIL_DOMAIN` 是帳號在內部合成信箱時用的網域，
使用者永遠看不到它，維持預設 `checkin.local` 即可。

建立第一個系統管理員：

```bash
npm run create-admin fxadmin 系統管理員
```

啟動：

```bash
npm run dev
```

打開 http://localhost:3000 ，用 `fxadmin` / `fxadmin` 登入，系統會要求你立刻設定新密碼。

---

## 三、帳號規則

| | 系統管理員 | 註冊長 | 註冊組員 | 報到人員 |
|---|:--:|:--:|:--:|:--:|
| 建立系統管理員 / 註冊長 / 註冊組員 | ✅ | ❌ | ❌ | ❌ |
| 建立報到人員 | ✅ | ✅ | ❌ | ❌ |
| 變更他人身分 | ✅ | ❌ | ❌ | ❌ |
| 重設 / 停用 / 刪除 | 全部帳號 | 只限自己建立的報到人員 | ❌ | ❌ |

- 登入使用**帳號**而非信箱，限 6–20 字元英數字與底線。
- 新帳號的**初始密碼與帳號相同**，首次登入強制變更（至少 8 字元、不可與帳號相同）。
- 沒有信箱可寄驗證信，忘記密碼一律由上層在後台重設回初始值。
- 帳號下限是 6 字元而非更短，因為初始密碼等於帳號，而 Supabase 的密碼下限為 6。

---

## 四、資料表

| 資料表 | 用途 |
|---|---|
| `app_users` | 使用者與角色 |
| `sub_events` | 子活動（含 `require_checkout`、`min_stay_minutes`） |
| `participants` | 人員主檔，`code` 編號與 `qr_code` 全域唯一 |
| `registrations` | 參與名單 = 人員 × 子活動，組別存在這裡 |
| `attendance_logs` | 報到 / 簽退紀錄，含撤銷稽核欄位 |
| `sub_event_grants` | 註冊組員的子活動授權 |
| `import_batches` | 匯入批次（可回溯） |
| `app_settings` | 全域設定（報到畫面預設顯示欄位） |

兩個關鍵索引：

- `attendance_logs_active_key` — 同一筆名單的同一種紀錄（報到 / 簽退）同時只能有一筆未撤銷，兩台裝置同時掃同一人也只會成立一筆。
- `attendance_logs_client_key` — 離線佇列的冪等鍵，重送不會重複寫入。

---

## 五、名單匯入

1. 到「子活動」建立活動，進入該活動頁。
2. 在「匯入名單」選擇 Excel 或 CSV（讀第一個工作表，第一列為標題）。
3. 系統會自動猜欄位對應，確認後匯入。至少要有**姓名**與**編號**；沒有 QR 欄位時以編號作為 QR 內容。
4. 其他欄位選「其他欄位（保留）」會存進 `extra`，之後可在報到畫面選擇顯示。

編號是全系統的人身分鍵，會自動去空白並轉大寫。同一個編號再次匯入時，
會沿用同一個人與同一張 QR，只更新該子活動的組別與欄位。
每次匯入都會留下批次紀錄，可以整批復原。

## 六、後續階段

- **P3** 現場報到頁：報到 / 簽退模式切換、3 秒重複掃碼冷卻、最短停留確認
- **P4** IndexedDB 名單快取與離線同步佇列
- **P5** 即時儀表板、報到紀錄管理、Excel 匯出、顯示欄位設定
