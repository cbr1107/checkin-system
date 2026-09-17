'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Button from './Button';

const UiContext = createContext(null);

export function useToast() {
  const ctx = useContext(UiContext);
  return ctx?.toast || (() => {});
}

/** 取代 window.confirm：不會凍結畫面，而且可以顯示處理中 */
export function useConfirm() {
  const ctx = useContext(UiContext);
  return ctx?.confirm || (async () => false);
}

let nextId = 1;

export default function UiProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null);
  const resolver = useRef(null);
  const cancelRef = useRef(null);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message, tone = 'info', duration = 4000) => {
      const id = nextId++;
      setToasts((prev) => [...prev, { id, message, tone }]);
      if (duration) setTimeout(() => dismiss(id), duration);
      return id;
    },
    [dismiss]
  );

  const confirm = useCallback((options) => {
    const config =
      typeof options === 'string' ? { description: options } : options || {};
    setDialog({
      title: config.title || '確認操作',
      description: config.description || '',
      confirmLabel: config.confirmLabel || '確定',
      cancelLabel: config.cancelLabel || '取消',
      variant: config.variant || 'primary',
      prompt: config.prompt || null,
      value: config.defaultValue || '',
    });
    return new Promise((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = useCallback((value) => {
    resolver.current?.(value);
    resolver.current = null;
    setDialog(null);
  }, []);

  // Esc 關閉、焦點落在取消鍵上
  useEffect(() => {
    if (!dialog) return undefined;
    cancelRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') settle(dialog.prompt ? null : false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, settle]);

  const value = useMemo(() => ({ toast, confirm }), [toast, confirm]);

  return (
    <UiContext.Provider value={value}>
      {children}

      <div className="toast-region" role="region" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            <span>{t.message}</span>
            <button
              className="toast-close"
              onClick={() => dismiss(t.id)}
              aria-label="關閉通知"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {dialog && (
        <div
          className="dialog-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) settle(dialog.prompt ? null : false);
          }}
        >
          <div className="dialog" role="dialog" aria-modal="true">
            <h2>{dialog.title}</h2>
            {dialog.description && <p>{dialog.description}</p>}

            {dialog.prompt && (
              <label className="field">
                <span>{dialog.prompt}</span>
                <input
                  autoFocus
                  value={dialog.value}
                  onChange={(e) => setDialog((d) => ({ ...d, value: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') settle(dialog.value);
                  }}
                />
              </label>
            )}

            <div className="dialog-actions">
              <Button
                ref={cancelRef}
                variant="secondary"
                onClick={() => settle(dialog.prompt ? null : false)}
              >
                {dialog.cancelLabel}
              </Button>
              <Button
                variant={dialog.variant}
                onClick={() => settle(dialog.prompt ? dialog.value : true)}
              >
                {dialog.confirmLabel}
              </Button>
            </div>
          </div>
        </div>
      )}
    </UiContext.Provider>
  );
}
