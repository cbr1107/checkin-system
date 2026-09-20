'use client';

import { useCallback, useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import Switch from '@/components/ui/Switch';
import Spinner from '@/components/ui/Spinner';
import { useToast, useConfirm } from '@/components/ui/UiProvider';
import { downloadBlob, safeFilename } from '@/lib/download';

export default function LoginKeyModal({ user, onClose }) {
  const toast = useToast();
  const confirm = useConfirm();

  const [data, setData] = useState(null);
  const [qr, setQr] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const render = useCallback(async (key) => {
    try {
      const QRCode = (await import('qrcode')).default;
      setQr(
        await QRCode.toDataURL(key, { width: 432, margin: 1, errorCorrectionLevel: 'M' })
      );
    } catch {
      setQr('');
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/admin/users/${user.id}`);
    const json = await res.json();
    setLoading(false);

    if (!res.ok) {
      toast(json.error || '讀取失敗', 'error');
      onClose();
      return;
    }
    setData(json);
    render(json.login_key);
  }, [user.id, toast, onClose, render]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(body, confirmConfig) {
    if (confirmConfig) {
      const agreed = await confirm(confirmConfig);
      if (!agreed) return;
    }
    setBusy(true);
    const res = await fetch(`/api/admin/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    setBusy(false);

    if (!res.ok) {
      toast(json.error || '操作失敗', 'error');
      return;
    }
    if (json.login_key) {
      setData((prev) => ({ ...prev, login_key: json.login_key }));
      render(json.login_key);
      toast('已重新產生，舊的識別碼即刻失效', 'success', 6000);
    } else {
      toast('已更新', 'success');
      load();
    }
  }

  /** 把姓名、QR 與金鑰合成一張圖片後直接下載 */
  async function downloadKeyImage() {
    if (!qr || !data) return;

    const W = 720;
    const H = 980;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#0d4a44';
    ctx.fillRect(0, 0, W, 10);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#16201c';
    ctx.font = '600 46px "Microsoft JhengHei", "PingFang TC", sans-serif';
    ctx.fillText(data.display_name, W / 2, 110);

    ctx.fillStyle = '#5b6862';
    ctx.font = '28px "Microsoft JhengHei", "PingFang TC", sans-serif';
    ctx.fillText(data.account, W / 2, 158);

    const img = new Image();
    img.src = qr;
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });

    const size = 440;
    ctx.drawImage(img, (W - size) / 2, 200, size, size);

    ctx.fillStyle = '#16201c';
    ctx.font = '30px ui-monospace, Consolas, monospace';
    const key = data.login_key;
    ctx.fillText(key.slice(0, 13), W / 2, 712);
    ctx.fillText(key.slice(13), W / 2, 754);

    ctx.fillStyle = '#9b2c26';
    ctx.font = '24px "Microsoft JhengHei", "PingFang TC", sans-serif';
    ctx.fillText('此識別碼可直接登入系統', W / 2, 850);
    ctx.fillText('請勿張貼或轉傳', W / 2, 886);

    ctx.fillStyle = '#5b6862';
    ctx.font = '20px "Microsoft JhengHei", "PingFang TC", sans-serif';
    ctx.fillText('現場報到系統', W / 2, 940);

    canvas.toBlob((blob) => {
      if (!blob) {
        toast('圖片產生失敗', 'error');
        return;
      }
      downloadBlob(blob, `${safeFilename(data.account)}-識別碼.png`);
      toast('已下載識別碼圖片', 'success');
    }, 'image/png');
  }

  return (
    <Modal open title={`${user.display_name} 的識別碼`} onClose={onClose}>
      {loading || !data ? (
        <div className="empty">
          <Spinner size="lg" />
        </div>
      ) : (
        <div className="key-display">
          {qr ? (
            <div className="key-qr">
              <img src={qr} alt="識別碼 QR" />
            </div>
          ) : (
            <div className="empty">QR 產生失敗</div>
          )}

          <code className="key-text">{data.login_key}</code>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            <Button
              size="sm"
              onClick={() =>
                navigator.clipboard?.writeText(data.login_key).then(
                  () => toast('已複製', 'success'),
                  () => toast('複製失敗', 'error')
                )
              }
            >
              複製
            </Button>
            <Button size="sm" onClick={downloadKeyImage}>
              下載圖片
            </Button>
            <Button
              size="sm"
              variant="destructive"
              loading={busy}
              onClick={() =>
                act(
                  { action: 'regenerate_key' },
                  {
                    title: '重新產生識別碼',
                    description: '舊的識別碼會立即失效，已經發出去的 QR 將無法再登入。',
                    confirmLabel: '重新產生',
                    variant: 'destructive',
                  }
                )
              }
            >
              重新產生
            </Button>
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, width: '100%' }}>
            <Switch
              checked={data.qr_login_enabled}
              disabled={busy}
              onChange={(v) => act({ action: 'set_qr_login', enabled: v })}
            >
              允許這個帳號使用掃碼登入
            </Switch>
          </div>
        </div>
      )}
    </Modal>
  );
}
