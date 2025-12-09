export const UserLevel = {
  Owner: 'Owner',
  Public: 'Public',
} as const;
export type UserLevel = typeof UserLevel[keyof typeof UserLevel];
