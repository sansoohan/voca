export const VocaEnv = {
  LocalDev: 'localdev',
  Dev: 'dev',
  Stage: 'stage',
  Prod: 'prod',
  Hotfix: 'hotfix',
} as const;
export type VocaEnv = typeof VocaEnv[keyof typeof VocaEnv];
