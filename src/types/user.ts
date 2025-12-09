import type { UserLevel } from '~/enums/user';

export interface UserDoc {
  readAccess: UserLevel;
  words: string;
}
