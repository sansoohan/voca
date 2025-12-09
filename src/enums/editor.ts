export const EditorMode = {
  Simple: 'Simple',
  Advanced: 'Advanced',
} as const;
export type EditorMode = typeof EditorMode[keyof typeof EditorMode];
