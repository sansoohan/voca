export const EditorMode = {
  Simple: 'Simple',
  Advanced: 'Advanced',
} as const;
export type EditorMode = typeof EditorMode[keyof typeof EditorMode];

export const EditorModalMode = {
  Add: 'Add',
  Edit: 'Edit',
} as const;
export type EditorModalMode = typeof EditorModalMode[keyof typeof EditorModalMode];
