export type Bookmark = {
  wordbookPath: string;
  wordIndex: number;
  updatedAt: number;
  searchQuery?: string | null;
  shuffleWordIndices?: number[] | null;
};
