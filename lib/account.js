const DOMAIN = process.env.NEXT_PUBLIC_ACCOUNT_EMAIL_DOMAIN || 'checkin.local';

export const ACCOUNT_PATTERN = /^[A-Za-z0-9_]{6,20}$/;

export function normalizeAccount(account) {
  return String(account || '').trim().toLowerCase();
}

/** 帳號 → 內部信箱。使用者永遠不會看到這組信箱。 */
export function accountToEmail(account) {
  return `${normalizeAccount(account)}@${DOMAIN}`;
}

export function validateAccount(account) {
  if (!ACCOUNT_PATTERN.test(normalizeAccount(account))) {
    return '帳號限 6–20 字元，只能使用英文、數字與底線';
  }
  return null;
}
