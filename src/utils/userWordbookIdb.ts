// utils/userWordbookIdb.ts
// Persist the last opened wordbook for a logged-in user.

export type LastWordbookRow = {
  uid: string;
  filename: string;
  fullPath: string;
  updatedAt: number;
};

const DB_NAME = 'voca_user_wordbook_state';
const DB_VERSION = 1;
const STORE_STATE = 'state';
const STORE_META = 'meta';
const SCHEMA_TAG = 'user-wordbook-state-v1.0';

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

      if (oldVersion > 0) {
        if (db.objectStoreNames.contains(STORE_STATE)) db.deleteObjectStore(STORE_STATE);
        if (db.objectStoreNames.contains(STORE_META)) db.deleteObjectStore(STORE_META);
      }

      if (!db.objectStoreNames.contains(STORE_STATE)) {
        db.createObjectStore(STORE_STATE, { keyPath: 'uid' });
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
  const tx = db.transaction([STORE_META, STORE_STATE], 'readwrite');
  const meta = tx.objectStore(STORE_META);
  const state = tx.objectStore(STORE_STATE);

  const getReq = meta.get('schemaTag');
  const prevTag: string | null = await new Promise((resolve, reject) => {
    getReq.onsuccess = () => resolve((getReq.result?.value ?? null) as string | null);
    getReq.onerror = () => reject(getReq.error);
  });

  if (prevTag !== SCHEMA_TAG) {
    state.clear();
    meta.put({ key: 'schemaTag', value: SCHEMA_TAG });
    meta.put({ key: 'schemaTagUpdatedAt', value: Date.now() });
  }

  await txDone(tx);
}

export async function readLastWordbook(uid: string): Promise<LastWordbookRow | null> {
  const db = await openDB();
  try {
    await ensureSchemaTag(db);

    const tx = db.transaction(STORE_STATE, 'readonly');
    const req = tx.objectStore(STORE_STATE).get(uid);

    const row = await new Promise<LastWordbookRow | null>((resolve, reject) => {
      req.onsuccess = () => resolve((req.result ?? null) as LastWordbookRow | null);
      req.onerror = () => reject(req.error);
    });

    await txDone(tx);
    return row;
  } finally {
    db.close();
  }
}

export async function writeLastWordbook(uid: string, filename: string, fullPath: string): Promise<void> {
  const db = await openDB();
  try {
    await ensureSchemaTag(db);

    const tx = db.transaction(STORE_STATE, 'readwrite');
    tx.objectStore(STORE_STATE).put({
      uid,
      filename,
      fullPath,
      updatedAt: Date.now(),
    } satisfies LastWordbookRow);

    await txDone(tx);
  } finally {
    db.close();
  }
}
