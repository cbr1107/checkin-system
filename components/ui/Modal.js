'use client';

import { useEffect, useRef } from 'react';

/** 一般用途的彈出視窗。Esc 或點背景關閉，開啟時鎖住背景捲動。 */
export default function Modal({ open, title, onClose, children, size = 'md' }) {
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);

    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();

    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`dialog dialog-${size} modal`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="toast-close" onClick={onClose} aria-label="關閉">
            ×
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
