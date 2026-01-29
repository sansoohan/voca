// utils/storage.ts
import {
  ref as storageRef,
  uploadString,
  getDownloadURL,
  listAll,
  deleteObject,
  type StorageReference,
} from 'firebase/storage';
import { storage, VITE_VOCA_ENV } from '~/constants/firebase';
import { UserLevel } from '~/enums/user';

export const DEFAULT_WORDBOOK_FILENAME = 'default.txt';

export function getWordbooksDir(uid: string) {
  return `voca/${VITE_VOCA_ENV}/users/${uid}/wordbooks`;
}

export function getWordbookPath(uid: string, filename: string) {
  // filename is user-provided; it must be validated at UI layer.
  return `${getWordbooksDir(uid)}/${filename}`;
}

export function getDefaultWordbookPath(uid: string) {
  return getWordbookPath(uid, DEFAULT_WORDBOOK_FILENAME);
}

// 이미 있으면 두고, 없으면 생성
export async function ensureDefaultWordbook(uid: string) {
  const path = getDefaultWordbookPath(uid);
  const fileRef = storageRef(storage, path);

  try {
    await getDownloadURL(fileRef);
  } catch (e: any) {
    if (e.code === 'storage/object-not-found') {
      await uploadString(fileRef, '', 'raw', {
        customMetadata: { readAccess: UserLevel.Owner },
      });
    } else {
      throw e;
    }
  }
}

export type UserWordbookFile = {
  filename: string;
  fullPath: string;
  ref: StorageReference;
};

export async function listUserWordbooks(uid: string): Promise<UserWordbookFile[]> {
  const dirRef = storageRef(storage, getWordbooksDir(uid));
  const res = await listAll(dirRef);

  const files: UserWordbookFile[] = res.items.map((it) => ({
    filename: it.name,
    fullPath: it.fullPath,
    ref: it,
  }));

  files.sort((a, b) => a.filename.localeCompare(b.filename));
  return files;
}

export async function createWordbook(uid: string, filename: string): Promise<void> {
  const path = getWordbookPath(uid, filename);
  const fileRef = storageRef(storage, path);
  await uploadString(fileRef, '', 'raw', {
    customMetadata: { readAccess: UserLevel.Owner },
  });
}

export async function deleteWordbook(uid: string, filename: string): Promise<void> {
  const path = getWordbookPath(uid, filename);
  const fileRef = storageRef(storage, path);
  await deleteObject(fileRef);
}
