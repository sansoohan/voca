// utils/storage.ts
import { ref as storageRef, uploadString, getDownloadURL } from 'firebase/storage';
import { storage, VITE_VOCA_ENV } from '~/constants/firebase';
import { UserLevel } from '~/enums/user';

export function getDefaultWordbookPath(uid: string) {
  return `voca/${VITE_VOCA_ENV}/users/${uid}/wordbooks/default.txt`;
}

// 이미 있으면 그냥 두고, 없으면 새로 만드는 함수
export async function ensureDefaultWordbook(uid: string) {
  const path = getDefaultWordbookPath(uid);
  const fileRef = storageRef(storage, path);

  try {
    await getDownloadURL(fileRef); // 있으면 통과
  } catch (e: any) {
    if (e.code === 'storage/object-not-found') {
      // 없으면 빈 파일 생성
      await uploadString(fileRef, '', 'raw', { customMetadata: { readAccess: UserLevel.Owner}});
    } else {
      // 다른 에러는 그대로 던져서 상위에서 잡게
      throw e;
    }
  }
}
