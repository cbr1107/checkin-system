export const APP_NAME = '現場報到系統';
export const ORG_NAME = '臺北醫學大學楓杏醫學青年服務團';
export const APP_VERSION = 'v0.5.0';
export const APP_VERSION_DATE = '2026-09-17';

export const ROLE_LABELS = {
  admin: '系統管理員',
  lead: '註冊長',
  staff: '註冊組員',
  checkin: '報到人員',
};

// 數字越大權限越高
export const ROLE_LEVEL = { checkin: 1, staff: 2, lead: 3, admin: 4 };

export function atLeast(role, min) {
  return (ROLE_LEVEL[role] ?? 0) >= (ROLE_LEVEL[min] ?? 99);
}

// 誰能建立哪些角色
export const CREATABLE_ROLES = {
  admin: ['admin', 'lead', 'staff', 'checkin'],
  lead: ['checkin'],
  staff: [],
  checkin: [],
};
