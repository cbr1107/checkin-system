/** 報到結果的呈現規則與掃碼輸入判斷 */

export const RESULT_STYLES = {
  ok_in: { tone: 'ok', title: '報到成功' },
  ok_out: { tone: 'info', title: '簽退完成' },
  already_in: { tone: 'warn', title: '已經報到過' },
  already_out: { tone: 'warn', title: '已經簽退過' },
  not_checked_in: { tone: 'danger', title: '尚未報到' },
  too_soon: { tone: 'warn', title: '停留時間過短' },
  not_in_roster: { tone: 'danger', title: '不在這個活動的名單' },
  unknown_qr: { tone: 'danger', title: '查無這組條碼' },
  checkout_off: { tone: 'danger', title: '這個活動沒有開啟簽退' },
  empty: { tone: 'danger', title: '沒有讀到內容' },
  event_missing: { tone: 'danger', title: '找不到子活動' },
  unauthorized: { tone: 'danger', title: '沒有操作權限' },
  network: { tone: 'danger', title: '連線失敗' },
  offline_disabled: { tone: 'danger', title: '離線報到未開放' },
};

/** 同一組條碼在這段時間內重複讀到會被忽略（毫秒） */
export const SCAN_COOLDOWN_MS = 3000;

/** 條碼槍逐字輸入間隔的判定門檻（毫秒） */
export const SCANNER_GAP_MS = 60;

export function resultKey(status, type) {
  if (status === 'ok') return type === 'out' ? 'ok_out' : 'ok_in';
  return status;
}

export function describeResult(status, type, data) {
  const key = resultKey(status, type);
  const style = RESULT_STYLES[key] || { tone: 'danger', title: '無法處理' };
  let detail = '';

  if (key === 'already_in') {
    const at = data?.previous_at || data?.checked_in_at;
    const time = at ? formatTime(at) : '稍早';
    detail = data?.previous_by
      ? `已於 ${time} 由 ${data.previous_by} 報到`
      : `已於 ${time} 報到`;
  } else if (key === 'already_out') {
    detail = data?.checked_out_at ? `已於 ${formatTime(data.checked_out_at)} 簽退` : '';
  } else if (key === 'ok_out' && data?.checked_in_at) {
    detail = `停留 ${formatDuration(data.checked_in_at)}`;
  } else if (key === 'too_soon') {
    detail = `${data.minutes_elapsed} 分鐘前才報到，最短停留為 ${data.min_stay_minutes} 分鐘`;
  } else if (key === 'not_checked_in') {
    detail = '這個人還沒報到，不能簽退';
  } else if (key === 'not_in_roster') {
    detail = `${data?.name || ''}（${data?.code || ''}）不在名單中`;
  } else if (key === 'offline_disabled') {
    detail = '目前沒有網路，而系統設定未開放離線報到。請恢復連線後再試。';
  } else if (key === 'unknown_qr') {
    detail = data?.scanned ? `讀到的內容：${data.scanned}` : '';
  }

  return { ...style, detail };
}

export function formatTime(value) {
  return new Date(value).toLocaleTimeString('zh-TW', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDuration(from, to = Date.now()) {
  const minutes = Math.max(0, Math.round((new Date(to) - new Date(from)) / 60000));
  if (minutes < 60) return `${minutes} 分鐘`;
  return `${Math.floor(minutes / 60)} 小時 ${minutes % 60} 分`;
}

/** 產生離線佇列用的冪等鍵 */
export function makeEventId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** 從全域設定 / 子活動覆寫取出要顯示的欄位 */
export function resolveDisplayFields(eventFields, globalFields) {
  const source = eventFields?.fields || globalFields?.fields || [];
  return source.filter((f) => f.enabled !== false);
}

/** 依欄位定義取值 */
export function fieldValue(field, data) {
  if (field.key === 'name') return data.name;
  if (field.key === 'code') return data.code;
  if (field.key === 'team') return data.team;
  return data.extra?.[field.key] ?? data.extra?.[field.label];
}

/** 短促提示音，現場吵雜時比畫面更快被察覺 */
export function beep(tone = 'ok') {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = tone === 'ok' ? 880 : tone === 'info' ? 660 : 320;
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
    setTimeout(() => ctx.close(), 400);
  } catch {
    // 靜音失敗不影響報到
  }
}

export function buzz(tone = 'ok') {
  try {
    if (!navigator.vibrate) return;
    navigator.vibrate(tone === 'ok' || tone === 'info' ? 60 : [80, 60, 80]);
  } catch {
    // 同上
  }
}

/**
 * 組別排序：數字依數值大小（1 < 2 < 10，不是 1 < 10 < 2），
 * 「未分組」固定排在最後。
 */
export function compareTeams(a, b) {
  const NO_TEAM = '未分組';
  if (a === NO_TEAM) return b === NO_TEAM ? 0 : 1;
  if (b === NO_TEAM) return -1;
  return String(a).localeCompare(String(b), 'zh-Hant', {
    numeric: true,
    sensitivity: 'base',
  });
}
