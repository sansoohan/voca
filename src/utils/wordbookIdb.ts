// utils/wordbookIdb.ts
// -----------------------------------------------------------------------------
// Wordbook text cache in IndexedDB (separate from bookmarkIdb.ts)
//
// Rule:
// - Compare Firebase Storage object's last-updated value(meta.updated) with cached.updated.
// - If same: use cached text.
// - If different: download from Storage, then overwrite cache.
//
// Notes:
// - Performance cache only (not auth-sensitive).
// - Cache key = Storage fullPath.

import {
  getDownloadURL,
  getMetadata,
  type StorageReference,
} from 'firebase/storage';

const DB_NAME = 'voca_wordbook_cache';
const DB_VERSION = 1;

const STORE_WORDBOOKS = 'wordbooks';
const STORE_META = 'meta';

// If semantics change, bump this tag (forces clear even if DB_VERSION forgotten)
const SCHEMA_TAG = 'wordbook-cache-v1.0-meta.updated';

type WordbookCacheRow = {
  path: string;
  updated: string; // meta.updated
  text: string;
  savedAt: number;
};

// -------------------------
// IndexedDB helpers
// -------------------------
function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (ev) => {
      const db = req.result;
      const oldVersion = (ev as IDBVersionChangeEvent).oldVersion;

      // Policy: DB_VERSION bump → wipe
      if (oldVersion > 0) {
        if (db.objectStoreNames.contains(STORE_WORDBOOKS)) {
          db.deleteObjectStore(STORE_WORDBOOKS);
        }
        if (db.objectStoreNames.contains(STORE_META)) {
          db.deleteObjectStore(STORE_META);
        }
      }

      if (!db.objectStoreNames.contains(STORE_WORDBOOKS)) {
        const store = db.createObjectStore(STORE_WORDBOOKS, { keyPath: 'path' });
        store.createIndex('savedAt', 'savedAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function ensureSchemaTag(db: IDBDatabase): Promise<void> {
  const tx = db.transaction([STORE_META, STORE_WORDBOOKS], 'readwrite');
  const meta = tx.objectStore(STORE_META);
  const wb = tx.objectStore(STORE_WORDBOOKS);

  const getReq = meta.get('schemaTag');
  const prevTag: string | null = await new Promise((resolve, reject) => {
    getReq.onsuccess = () => resolve(getReq.result?.value ?? null);
    getReq.onerror = () => reject(getReq.error);
  });

  if (prevTag !== SCHEMA_TAG) {
    wb.clear();
    meta.put({ key: 'schemaTag', value: SCHEMA_TAG });
    meta.put({ key: 'schemaTagUpdatedAt', value: Date.now() });
  }

  await txDone(tx);
}

async function readRow(
  db: IDBDatabase,
  path: string,
): Promise<WordbookCacheRow | null> {
  const tx = db.transaction(STORE_WORDBOOKS, 'readonly');
  const req = tx.objectStore(STORE_WORDBOOKS).get(path);

  const row = await new Promise<WordbookCacheRow | null>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });

  await txDone(tx);
  return row;
}

async function writeRow(
  db: IDBDatabase,
  row: WordbookCacheRow,
): Promise<void> {
  const tx = db.transaction(STORE_WORDBOOKS, 'readwrite');
  tx.objectStore(STORE_WORDBOOKS).put(row);
  await txDone(tx);
}

// -------------------------
// Public API
// -------------------------
export type WordbookCacheResult = {
  text: string;
  fromCache: boolean;
  updated: string;
  meta: Awaited<ReturnType<typeof getMetadata>>;
};

export async function loadWordbookTextCached(
  fileRef: StorageReference,
): Promise<WordbookCacheResult> {
  // 1) metadata 먼저 (cheap)
  const meta = await getMetadata(fileRef);
  const updated = meta.updated;
  const path = fileRef.fullPath;

  const db = await openDB();
  try {
    await ensureSchemaTag(db);

    const cached = await readRow(db, path);
    if (cached && cached.updated === updated) {
      return {
        text: cached.text ?? '',
        fromCache: true,
        updated,
        meta,
      };
    }

    // 2) cache miss / stale → download
    const url = await getDownloadURL(fileRef);
    const res = await fetch(url);
    const txt = await res.text();

    await writeRow(db, {
      path,
      updated,
      text: txt ?? '',
      savedAt: Date.now(),
    });

    return {
      text: txt ?? '',
      fromCache: false,
      updated,
      meta,
    };
  } finally {
    db.close();
  }
}
