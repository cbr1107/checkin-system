'use client';

/** 全螢幕忙碌提示：長時間的動作（匯入、同步、匯出）用這個 */
export default function Busy({ show, label = '處理中…' }) {
  if (!show) return null;
  return (
    <div className="busy-overlay" role="status" aria-live="polite">
      <div className="busy-box">
        <span className="spinner" aria-hidden="true" />
        <span>{label}</span>
      </div>
    </div>
  );
}
