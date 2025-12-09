import type { UserLevel } from '~/enums/user';

export interface UserDoc {
  readAccess: UserLevel;
  words: string;
}

export type WordRow = {
  word: string;
  link: string | null;
  createdAt: string | null;
  order: number | null; // 순번이 없을 수도 있으니 null 허용
};
