/** 觸發瀏覽器下載，不開新視窗、不進列印對話框 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 檔名中不能出現的字元 */
export function safeFilename(name) {
  return String(name || '檔案')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
    .slice(0, 60);
}
