'use client';

import { forwardRef } from 'react';
import Spinner from './Spinner';

/**
 * 所有按鈕都走這個元件：loading 時就地轉圈並自動停用，
 * 使用者不會按了沒反應，也不會重複送出。
 */
const Button = forwardRef(function Button(
  {
    children,
    variant = 'secondary',
    size = 'md',
    loading = false,
    block = false,
    className = '',
    disabled,
    type = 'button',
    ...rest
  },
  ref
) {
  const classes = [
    'btn',
    `btn-${variant}`,
    size !== 'md' ? `btn-${size}` : '',
    block ? 'btn-block' : '',
    loading ? 'btn-loading' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {children}
      {loading && (
        <span className="btn-spinner">
          <Spinner size="sm" />
        </span>
      )}
    </button>
  );
});

export default Button;
