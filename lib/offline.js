/**
 * 離線儲存：名單快取 + 待送出佇列
 * 直接用 IndexedDB，不額外引入套件。
 */

const DB_NAME = 'checkin-offline';
const DB_VERSION = 1;
const ROSTER = 'roster';
const QUEUE = 'queue';

let dbPromise = null;

function openDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ROSTER)) {
        db.createObjectStore(ROSTER, { keyPath: 'sub_event_id' });
      }
      if (!db.objectStoreNames.contains(QUEUE)) {
        const store = db.createObjectStore(QUEUE, { keyPath: 'id' });
        store.createIndex('by_event', 'sub_event_id');
        store.createIndex('by_time', 'occurred_at');
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });

  return dbPromise;
}

function run(store, mode, action) {
  return openDb().then(
    (db) =>
      new Promise((resolve) => {
        if (!db) return resolve(null);
        const tx = db.transaction(store, mode);
        const req = action(tx.objectStore(store));
        tx.oncomplete = () => resolve(req?.result ?? null);
        tx.onerror = () => resolve(null);
        tx.onabort = () => resolve(null);
      })
  );
}

/* ---------------- 名單快取 ---------------- */

export function saveRoster(subEventId, event, rows) {
  return run(ROSTER, 'readwrite', (store) =>
    store.put({
      sub_event_id: subEventId,
      event,
      rows,
      cached_at: new Date().toISOString(),
    })
  );
}

export function loadRoster(subEventId) {
  return run(ROSTER, 'readonly', (store) => store.get(subEventId));
}

/* ---------------- 送出佇列 ---------------- */

export function enqueue(item) {
  return run(QUEUE, 'readwrite', (store) => store.put(item));
}

export function dequeue(id) {
  return run(QUEUE, 'readwrite', (store) => store.delete(id));
}

export async function listQueue(subEventId) {
  const all = await run(QUEUE, 'readonly', (store) => store.getAll());
  const items = all || [];
  return items
    .filter((item) => !subEventId || item.sub_event_id === subEventId)
    .sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at));
}

export async function queueCount(subEventId) {
  return (await listQueue(subEventId)).length;
}

/** 累積過多失敗時，避免同一筆無限重試 */
export function bumpAttempt(item) {
  return enqueue({ ...item, attempts: (item.attempts || 0) + 1 });
}
