// utils/bookmarkIdb.ts
import type { Bookmark } from '~/types/bookmark';

const DB_NAME = 'voca_local';
const DB_VERSION = 1; // 구조 바뀌면 올린다(하지만 깜빡할 수 있으니 TAG도 둠)
const STORE_BOOKMARKS = 'bookmarks';
const STORE_META = 'meta';

// "의미/정책"이 바뀌면 이 문자열을 바꿔라.
// DB_VERSION을 깜빡해도 이것만 바꿔도 초기화됨.
const SCHEMA_TAG = 'bookmark-v1.0-search+shuffle-order';

// --- helpers ---
function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function stripUndefinedDeep<T>(v: T): T {
  if (Array.isArray(v)) return v.map(stripUndefinedDeep) as any;
  if (v && typeof v === 'object') {
    const out: any = {};
    for (const [k, val] of Object.entries(v as any)) {
      if (val === undefined) continue;
      out[k] = stripUndefinedDeep(val);
    }
    return out;
  }
  return v;
}

/**
 * guard: IDB는 "비로그인 전용"
 * - currentUserUid가 있으면(로그인 상태) 여기서 바로 막는다.
 */
function assertGuestOnly(currentUserUid: string | null | undefined) {
  if (currentUserUid) {
    // 개발 중 실수 방지(로그인 상태에서 IDB 쓰면 데이터 꼬임)
    throw new Error('[bookmarkStore] IndexedDB is guest-only. Refuse operation for logged-in user.');
  }
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (ev) => {
      const db = req.result;
      const oldVersion = (ev as IDBVersionChangeEvent).oldVersion;

      // 정책: DB_VERSION이 올라가면 "전부 삭제"
      if (oldVersion > 0) {
        if (db.objectStoreNames.contains(STORE_BOOKMARKS)) db.deleteObjectStore(STORE_BOOKMARKS);
        if (db.objectStoreNames.contains(STORE_META)) db.deleteObjectStore(STORE_META);
      }

      // (재)생성
      if (!db.objectStoreNames.contains(STORE_BOOKMARKS)) {
        const store = db.createObjectStore(STORE_BOOKMARKS, { keyPath: 'wordbookPath' });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * SCHEMA_TAG 이중화
 * - DB_VERSION을 깜빡해도, TAG가 바뀌면 clear.
 * - 전략: meta store에 { key: 'schemaTag', value: SCHEMA_TAG } 저장
 * - 다르면 bookmarks store clear + meta 갱신
 */
async function ensureSchemaTag(db: IDBDatabase): Promise<void> {
  const tx = db.transaction([STORE_META, STORE_BOOKMARKS], 'readwrite');
  const meta = tx.objectStore(STORE_META);
  const bm = tx.objectStore(STORE_BOOKMARKS);

  const getReq = meta.get('schemaTag');
  const prevTag: string | null = await new Promise((resolve, reject) => {
    getReq.onsuccess = () => resolve((getReq.result?.value ?? null) as string | null);
    getReq.onerror = () => reject(getReq.error);
  });

  if (prevTag !== SCHEMA_TAG) {
    // 전체 삭제(데이터 초기화)
    bm.clear();
    meta.put({ key: 'schemaTag', value: SCHEMA_TAG });
    meta.put({ key: 'schemaTagUpdatedAt', value: Date.now() });
  }

  await txDone(tx);
}

// --- public API ---

export async function idbGetBookmark(wordbookPath: string, currentUserUid: string | null): Promise<Bookmark | null> {
  assertGuestOnly(currentUserUid);

  const db = await openDB();
  try {
    await ensureSchemaTag(db);

    const tx = db.transaction(STORE_BOOKMARKS, 'readonly');
    const store = tx.objectStore(STORE_BOOKMARKS);

    const req = store.get(wordbookPath);
    const result: Bookmark | null = await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve((req.result ?? null) as Bookmark | null);
      req.onerror = () => reject(req.error);
    });

    await txDone(tx);
    return result;
  } finally {
    db.close();
  }
}

export async function idbSetBookmark(bookmark: Bookmark, currentUserUid: string | null): Promise<void> {
  assertGuestOnly(currentUserUid);

  const db = await openDB();
  try {
    await ensureSchemaTag(db);

    const tx = db.transaction(STORE_BOOKMARKS, 'readwrite');
    const store = tx.objectStore(STORE_BOOKMARKS);

    const safe = stripUndefinedDeep(bookmark);
    store.put(safe);

    await txDone(tx);
  } finally {
    db.close();
  }
}

export async function idbDeleteBookmark(wordbookPath: string, currentUserUid: string | null): Promise<void> {
  assertGuestOnly(currentUserUid);

  const db = await openDB();
  try {
    await ensureSchemaTag(db);

    const tx = db.transaction(STORE_BOOKMARKS, 'readwrite');
    tx.objectStore(STORE_BOOKMARKS).delete(wordbookPath);
    await txDone(tx);
  } finally {
    db.close();
  }
}

export async function idbClearAllBookmarks(currentUserUid: string | null): Promise<void> {
  assertGuestOnly(currentUserUid);

  const db = await openDB();
  try {
    await ensureSchemaTag(db);

    const tx = db.transaction(STORE_BOOKMARKS, 'readwrite');
    tx.objectStore(STORE_BOOKMARKS).clear();
    await txDone(tx);
  } finally {
    db.close();
  }
}
