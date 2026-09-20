import { randomInt } from 'node:crypto';

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const DIGIT = '23456789';
const SYMBOL = '!#$%&*+-=?@^_~';
const ALL = UPPER + LOWER + DIGIT + SYMBOL;

const LENGTH = 26;

function pick(set) {
  return set[randomInt(set.length)];
}

/**
 * 產生 26 碼識別金鑰。
 * 四類字元各至少一個，其餘隨機；排除 0/O/1/l/I 這類容易看錯的字元，
 * 因為金鑰偶爾需要人工輸入。
 */
export function generateLoginKey() {
  const chars = [pick(UPPER), pick(LOWER), pick(DIGIT), pick(SYMBOL)];
  while (chars.length < LENGTH) chars.push(pick(ALL));

  // Fisher–Yates，避免固定的前四碼類別
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join('');
}
