export type PageSize = 10 | 15 | 20 | 25 | 30 | 40 | 50 | 60 | 70 | 100;

// 간편 에디터에서 보여줄 아이템 (원본 lineIndex를 기억해야 함)
export type SimpleItem = {
  lineIndex: number; // text.split('\n') 기준 인덱스
  word: string;
  link: string | null;
};
